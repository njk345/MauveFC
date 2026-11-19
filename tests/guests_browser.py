"""Guest workflow with synthetic intercepted services only; no production writes."""
import base64, copy, json, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE=os.getenv('MAUVE_BASE_URL','http://127.0.0.1:3100')
settings=dict(line.split('=',1) for line in Path('.env.production.local').read_text().splitlines() if '=' in line and not line.startswith('#'))
API=settings['NEXT_PUBLIC_SUPABASE_URL']
S='66666666-6666-4666-8666-666666666666';OLD='66666666-6666-4666-8666-666666666667'
A='77777777-7777-4777-8777-777777777771';B='77777777-7777-4777-8777-777777777772'
ids=[f'00000000-0000-4000-8000-{i+1:012}' for i in range(9)]
players=[dict(id=pid,name=f'Roster Player {i}' if i<8 else 'Returning Player',number=i+1,position='Midfielder',initials='RP',hometown='',bio='',isPublic=False) for i,pid in enumerate(ids)]
result=dict(home=3,away=1,onFieldHome=3,onFieldAway=1,basis='played',reason='',attendance='unrecorded',scorers='unrecorded',assists='unrecorded',ownGoals=0,stats=[],published=True)
fixture=dict(id=A,seasonId=S,opponent='Past United',opponentCode='PU',color='#657293',kickoff='2026-10-01T20:00:00Z',venue='Test pitch',round=1,home=True,status='completed',revision=4,guestPlayerIds=[],result=result)
data=dict(players=players,seasons=[dict(id=S,name='Current season',competition='Test',format='7v7'),dict(id=OLD,name='Past season',competition='Test',format='7v7')],roster=[dict(seasonId=S,playerId=pid) for pid in ids[:8]]+[dict(seasonId=OLD,playerId=ids[8])],matches=[fixture,{k:v for k,v in {**copy.deepcopy(fixture),'id':B,'opponent':'Future FC','round':2,'status':'scheduled','revision':0,'kickoff':'2099-01-01T20:00:00Z'}.items() if k!='result'}])
sheet=dict(formation='2-3-1',starters=ids[:7],bench=[ids[7]])
lineups={B:dict(matchId=B,payload=copy.deepcopy(sheet),shared=True,hasDraft=False,updatedAt='2026-11-19T12:00:00Z',revision=1)}
posts=[dict(id='official-1',matchId=B,kind='official',payload=copy.deepcopy(sheet),authorName='Captain',createdAt='2026-11-19T12:00:00Z',canDelete=False)]
writes=dict(result=0,guest=0,lineup=0,suggestion=0);errors=[]

def public():
    value=copy.deepcopy(data);value['players']=[];value['roster']=[]
    for m in value['matches']:
        m.pop('guestPlayerIds',None)
        if m.get('result'):m['result']['stats']=[]
    return value
def directory():
    return [{**p,'rosterSeasonIds':[r['seasonId'] for r in data['roster'] if r['playerId']==p['id']],
        'guestGames':sum(p['id'] in m.get('guestPlayerIds',[]) for m in data['matches']),
        'appearances':sum(any(s['playerId']==p['id'] and s['appeared'] for s in m.get('result',{}).get('stats',[])) for m in data['matches'] if m.get('result',{}).get('published'))} for p in data['players']]
def season_stats(kind,season):
    member=kind in ['captain','player']
    matches=[m for m in data['matches'] if m['seasonId']==season]
    eligible={r['playerId'] for r in data['roster'] if r['seasonId']==season}|{pid for m in matches for pid in m.get('guestPlayerIds',[])}
    finals=[m['result'] for m in matches if m['status']=='completed' and m.get('result',{}).get('published')]
    rows=[]
    for p in data['players']:
        if p['id'] not in eligible or (not member and not p['isPublic']):continue
        stats=[(r,s) for r in finals for s in r['stats'] if s['playerId']==p['id']]
        rows.append({**p,'isGuest':not any(r['seasonId']==season and r['playerId']==p['id'] for r in data['roster']),
            'appearances':sum(s['appeared'] for r,s in stats),'goals':sum(s['goals'] for r,s in stats),'assists':sum(s['assists'] or 0 for r,s in stats),
            'appearancesKnown':any(s['appeared'] or r['attendance']=='complete' for r,s in stats),'goalsKnown':any(s['goals']>0 or r['scorers']=='complete' for r,s in stats),'assistsKnown':any(s['assists'] is not None and r['assists']!='unrecorded' for r,s in stats)})
    known=any(r['assists']!='unrecorded' for r in finals)
    return dict(teamView=member,players=rows,privatePlayerCount=0 if member else len(eligible),assistsTotal=sum(s['assists'] or 0 for r in finals for s in r['stats']) if known else None,assistsRecordedMatches=sum(r['assists']!='unrecorded' for r in finals),assistsCompleteMatches=sum(r['assists']=='complete' for r in finals))
def new_context(browser,kind='captain',width=390):
    context=browser.new_context(viewport=dict(width=width,height=1000))
    user=dict(id='33333333-3333-4333-8333-333333333333',aud='authenticated',role='authenticated',email='contract@example.test',app_metadata={},user_metadata={},created_at='2026-11-09T00:00:00Z')
    if kind:
        enc=lambda value:base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
        token=enc(dict(alg='HS256',typ='JWT'))+'.'+enc(dict(sub=user['id'],exp=int(time.time())+3600,aud='authenticated',role='authenticated'))+'.contract-only'
        session=dict(access_token=token,refresh_token='contract-only',expires_in=3600,expires_at=int(time.time())+3600,token_type='bearer',user=user)
        context.add_init_script('localStorage.setItem("mauve-fc-auth",'+json.dumps(json.dumps(session))+')')
    context.add_init_script('window.imageTexts=[];const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.imageTexts.push(String(text));return original.call(this,text,...args)}')
    def stub(route):
        req=route.request;path=req.url.split(API)[-1].split('?')[0];body=req.post_data_json if req.post_data else {};payload=None;status=200
        if req.method=='OPTIONS':pass
        elif path=='/auth/v1/user':payload=user if kind else None
        elif path.endswith('/get_team_access'):payload=dict(member=kind in ['captain','player'],role=kind,playerId=ids[0] if kind else None)
        elif path.endswith('/get_public_club'):payload=public()
        elif path.endswith('/get_captain_club'):assert kind=='captain';payload=data
        elif path=='/rest/v1/match_drafts':payload=[]
        elif path.endswith('/get_team_club'):assert kind in ['captain','player'];payload={**data,'lineups':list(lineups.values()),'rsvps':[]}
        elif path.endswith('/get_lineup_posts'):payload=posts
        elif path.endswith('/get_player_directory'):assert kind in ['captain','player'];payload=directory()
        elif path.endswith('/get_season_stats'):payload=season_stats(kind,body['p_season_id'])
        elif path.endswith('/add_match_guest') or path.endswith('/remove_match_guest'):
            assert kind=='captain';m=next(m for m in data['matches'] if m['id']==body['p_match_id'])
            if body['p_expected_revision']!=m['revision']:status=409;payload=dict(code='40001',message='Match changed')
            else:
                remove=path.endswith('/remove_match_guest')
                if body.get('p_player_id'):person=next(p for p in data['players'] if p['id']==body['p_player_id'])
                else:
                    person={**body['p_player'],'id':f'00000000-0000-4000-8000-{len(data["players"])+1:012}','initials':'JG','isPublic':False,'bio':'','hometown':''}
                    if any(p['name'].strip().lower()==person['name'].strip().lower() for p in data['players']) and not body['p_allow_same_name']:raise AssertionError('Duplicate creation without confirmation')
                    data['players'].append(person)
                if remove and any(s['playerId']==person['id'] and s['appeared'] for s in m.get('result',{}).get('stats',[])):
                    status=400;payload=dict(message='This guest has recorded stats and must remain in game history.')
                else:
                    if remove:m['guestPlayerIds']=[pid for pid in m['guestPlayerIds'] if pid!=person['id']]
                    elif person['id'] not in m['guestPlayerIds']:m['guestPlayerIds'].append(person['id'])
                    m['revision']+=1;writes['guest']+=1;payload=dict(matchId=m['id'],revision=m['revision'],action='remove' if remove else 'add',player=person)
        elif path.endswith('/save_match_result'):
            assert kind=='captain';m=next(m for m in data['matches'] if m['id']==body['p_match_id']);assert body['p_expected_revision']==m['revision']
            assert body['p_payload']['home']==3 and body['p_payload']['away']==1
            m['result']=copy.deepcopy(body['p_payload']);m['revision']+=1;m['status']='completed';writes['result']+=1
        elif path.endswith('/save_match_lineup'):
            assert kind=='captain';mid=body['p_match_id'];assert body['p_expected_revision']==lineups[mid]['revision'];writes['lineup']+=1
            lineups[mid].update(payload=copy.deepcopy(body['p_payload']),revision=lineups[mid]['revision']+1,hasDraft=not body['p_publish'],shared=True)
            if body['p_publish']:posts.insert(0,dict(id='official-'+str(writes['lineup']+1),matchId=mid,kind='official',payload=copy.deepcopy(body['p_payload']),authorName='Captain',createdAt='2026-11-19T18:00:00Z',canDelete=False))
        elif path.endswith('/post_lineup_suggestion'):
            assert kind=='player';writes['suggestion']+=1;posts.insert(0,dict(id='suggestion-1',matchId=body['p_match_id'],kind='suggestion',payload=copy.deepcopy(body['p_payload']),authorName='Member',createdAt='2026-11-19T19:00:00Z',canDelete=True));payload='suggestion-1'
        else:raise AssertionError('Unexpected service request '+path)
        route.fulfill(status=status,content_type='application/json',headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body=json.dumps(payload))
    context.route(API+'/**',stub);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    return context,page
def choose_guest(page,query,pid):
    page.get_by_role('button',name='Add guest substitute',exact=True).click()
    page.get_by_role('textbox',name='Search player directory').fill(query)
    page.get_by_role('combobox',name='Known guest player').select_option(pid)
    page.get_by_role('button',name='Add selected guest',exact=True).click()
    expect(page.locator('.guest-success')).to_contain_text('added to this game')
def card(page,label):return page.locator('.stat-card').filter(has=page.get_by_text(label,exact=True)).locator('strong')

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context,page=new_context(browser)
    page.goto(BASE+'/captain/stats/?match='+A,wait_until='networkidle')
    page.get_by_role('checkbox',name=players[0]['name']+' played').check();page.get_by_role('spinbutton',name=players[0]['name']+' goals').fill('1')
    choose_guest(page,'Returning',ids[8])
    expect(page.get_by_role('spinbutton',name=players[0]['name']+' goals')).to_have_value('1')
    expect(page.get_by_role('spinbutton',name='Returning Player goals')).to_be_disabled()
    page.get_by_role('button',name='Add guest substitute',exact=True).click();page.get_by_role('textbox',name='Search player directory').fill('Jordan Guest');page.get_by_role('textbox',name='Search player directory').press('Enter');assert writes['result']==0
    page.get_by_role('button',name='Create a new player',exact=True).click();page.get_by_role('spinbutton',name='Guest jersey number').fill('14');page.get_by_role('combobox',name='Guest position').select_option('Forward');page.get_by_role('button',name='Create player & add to game',exact=True).click()
    expect(page.locator('.guest-success')).to_contain_text('Jordan Guest added')
    guest=next(p for p in data['players'] if p['name']=='Jordan Guest');assert len(data['roster'])==9
    expect(page.get_by_role('spinbutton',name='Jordan Guest goals')).to_be_disabled()
    expect(page.get_by_role('spinbutton',name=players[0]['name']+' goals')).to_have_value('1')
    page.get_by_role('checkbox',name='Jordan Guest played').check();page.get_by_role('spinbutton',name='Jordan Guest goals').fill('2')
    page.get_by_role('combobox',name='Goals recording').select_option('complete');page.get_by_role('combobox',name='Assists recording').select_option('complete');page.get_by_role('spinbutton',name='Jordan Guest assists').fill('1');page.get_by_role('spinbutton',name=players[0]['name']+' assists').fill('1')
    page.get_by_role('button',name='Save player stats',exact=True).click();expect(page.get_by_text('Player stats saved. You can make corrections here anytime.')).to_be_visible()
    assert writes['result']==1 and fixture['result']['stats'][-1]['playerId']==guest['id']
    for width in [1440,390,320]:
        page.set_viewport_size(dict(width=width,height=1000));assert page.evaluate('document.documentElement.scrollWidth')<=width;page.screenshot(path=f'artifacts/guest-stats-{width}.png',full_page=True)
    # Repeated names require confirmation and remain separate player identities.
    page.get_by_role('button',name='Add guest substitute',exact=True).click();page.get_by_role('textbox',name='Search player directory').fill('Jordan Guest');page.get_by_role('button',name='Create a new player',exact=True).click()
    expect(page.get_by_role('button',name='Create player & add to game',exact=True)).to_be_disabled();page.get_by_role('checkbox',name='A player with this name exists.',exact=False).check();page.get_by_role('spinbutton',name='Guest jersey number').fill('22');page.get_by_role('button',name='Create player & add to game',exact=True).click();expect(page.locator('.guest-success')).to_contain_text('added to this game')
    duplicate=next(p for p in data['players'] if p['name']=='Jordan Guest' and p['id']!=guest['id']);assert duplicate['id']!=guest['id']
    page.get_by_role('button',name='Remove Jordan Guest from this game',exact=True).last.click();expect(page.locator('.guest-success')).to_contain_text('removed');assert any(p['id']==duplicate['id'] for p in data['players'])
    page.get_by_role('button',name='Remove Jordan Guest from this game',exact=True).click();expect(page.locator('.auth-error[role="alert"]')).to_contain_text('recorded stats')
    page.goto(BASE+'/captain/?match='+A,wait_until='networkidle');page.get_by_role('button',name='Add player details',exact=True).click();expect(page.get_by_role('spinbutton',name='Jordan Guest goals')).to_have_value('2')
    # Guest added mid-composition must preserve the captain's formation draft.
    page.goto(BASE+'/team/',wait_until='networkidle');page.get_by_role('button',name='Create a lineup from this',exact=True).click();page.get_by_role('combobox',name='Formation',exact=True).select_option('3-2-1')
    choose_guest(page,'Jordan',guest['id']);expect(page.get_by_role('combobox',name='Formation',exact=True)).to_have_value('3-2-1')
    page.get_by_role('combobox',name='Starter ST',exact=True).select_option(guest['id']);page.get_by_role('button',name='Save lineup draft',exact=True).click();expect(page.get_by_role('button',name='Save lineup draft',exact=True)).to_be_enabled()
    page.get_by_role('button',name='Publish official lineup',exact=True).click();expect(page.get_by_text('OFFICIAL',exact=True)).to_be_visible();assert guest['id'] in lineups[B]['payload']['starters']
    page.get_by_role('button',name='Preview image',exact=True).click();expect(page.get_by_role('dialog')).to_be_visible();assert any('Jordan Guest' in text for text in page.evaluate('window.imageTexts'));page.get_by_role('button',name='Close image export',exact=True).click()
    context.close()
    context,page=new_context(browser,'player')
    page.goto(BASE+'/team/',wait_until='networkidle');expect(page.get_by_role('button',name='Add guest substitute',exact=True)).to_have_count(0);expect(page.locator('.formation-pitch')).to_contain_text('Jordan Guest')
    page.get_by_role('button',name='Create a lineup from this',exact=True).click();page.get_by_role('button',name='Post suggestion',exact=True).click();expect(page.get_by_text('SUGGESTION',exact=True)).to_be_visible();assert writes['suggestion']==1
    page.goto(BASE+'/stats/',wait_until='networkidle');expect(page.locator('.leaderboard-table')).to_contain_text('Jordan Guest');expect(card(page,'GOALS SCORED')).to_have_text('3');expect(card(page,'ASSISTS RECORDED')).to_have_text('2')
    page.goto(BASE+'/players/',wait_until='networkidle');page.get_by_role('button',name='Club directory',exact=True).click();expect(page.get_by_role('heading',name='Club player directory')).to_be_visible();page.get_by_role('textbox',name='Search club directory').fill('Jordan');expect(page.locator('.directory-player-card')).to_have_count(2)
    for width in [1440,390,320]:
        page.set_viewport_size(dict(width=width,height=1000));assert page.evaluate('document.documentElement.scrollWidth')<=width;page.screenshot(path=f'artifacts/guest-directory-{width}.png',full_page=True)
    context.close()
    for kind in [None,'outsider']:
        context,page=new_context(browser,kind)
        page.goto(BASE+'/players/',wait_until='networkidle');expect(page.get_by_role('button',name='Club directory',exact=True)).to_have_count(0);assert 'Jordan Guest' not in page.locator('main').inner_text()
        page.goto(BASE+'/stats/',wait_until='networkidle');expect(card(page,'ASSISTS RECORDED')).to_have_text('2');assert 'Jordan Guest' not in page.locator('main').inner_text();expect(page.locator('.private-stats-row')).to_have_count(10)
        context.close()
    assert not errors,errors
    print('PASS existing/new/distinct-name guests, preserved unsaved stats and formations, captain publishing, member suggestions, image export, shared directory and public privacy')
    browser.close()
