"""Captain profile enrichment and private directory UX. All services intercepted."""
import copy
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from stats_view_browser import BASE, API, C, S, OLD, ids, names, players, data, new_context, errors

GUEST='88888888-8888-4888-8888-888888888881'
CONTACT='private.contact@example.test'
NOTE='Met at Tuesday pickup. Reliable last-minute sub.'

def details(email='',phone='',note='',revision=1):return dict(email=email,phone=phone,relationshipNote=note,revision=revision)

def setup(browser,kind='captain',width=1440):
    context,page,state,respond=new_context(browser,kind,width)
    records=copy.deepcopy(players)+[dict(id=GUEST,name='Returning Guest',number=0,position='Goalkeeper',initials='RG',hometown='',bio='',isPublic=False)]
    for p in records:p.update(preferredPositions=[],captainDetails=details())
    records[0].update(preferredPositions=['Striker'],captainDetails=details(CONTACT,'+1 (212) 555-0100',NOTE))
    records[-1].update(preferredPositions=['Goalkeeper','Right back'])
    state.update(records=records,roster=copy.deepcopy(data['roster']),saves=[],invites=[],fail_save=False,hold_directory=False,directory_pending=[])
    def snapshot(captain=False):
        result=copy.deepcopy(data);result['players']=copy.deepcopy(records);result['roster']=copy.deepcopy(state['roster'])
        if not captain:
            for p in result['players']:p.pop('captainDetails',None)
        return result
    def directory():
        value=snapshot(state['kind']=='captain')['players']
        for p in value:p.update(rosterSeasonIds=[r['seasonId'] for r in state['roster'] if r['playerId']==p['id']],guestGames=2 if p['id']==GUEST else 0,appearances=1)
        return value
    def handler(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        body=route.request.post_data_json or {};name=route.request.url.split('/')[-1]
        if name in ['get_captain_club','get_member_player_profiles']:
            assert state['kind'] in ['captain','player'];respond(route,snapshot(name=='get_captain_club'));return
        if name=='get_player_directory':
            value=directory()
            if state['hold_directory']:state['hold_directory']=False;state['directory_pending'].append((route,value));return
            respond(route,value);return
        if name=='save_player_details':
            assert state['kind']=='captain';assert body['p_club_id']==C
            if state['fail_save']:state['fail_save']=False;respond(route,dict(message='Player details changed. Reload the player and try again.',code='40001'),409);return
            player=next(p for p in records if p['id']==body['p_player_id']);assert body['p_expected_revision']==player['captainDetails']['revision']
            fields=body['p_details'];player['captainDetails']={k:fields[k].strip() for k in ['email','phone','relationshipNote']};player['captainDetails']['revision']=body['p_expected_revision']+1;player['preferredPositions']=fields['preferredPositions'];state['saves'].append(copy.deepcopy(body))
            respond(route,dict(captainDetails=player['captainDetails'],preferredPositions=player['preferredPositions']));return
        if name=='save_roster_player':
            assert state['kind']=='captain';player=copy.deepcopy(body['p_player']);state['saves'].append(copy.deepcopy(body));existing=next((p for p in records if p['id']==player['id']),None)
            if existing:records.remove(existing)
            player['captainDetails']['revision']+=1;records.append(player)
            state['roster'].append(dict(playerId=player['id'],seasonId=body['p_season_id']));respond(route,player['id']);return
        if name=='get_player_accounts':respond(route,[dict(playerId=p['id'],status='unlinked',email=None,role=None,expiresAt=None) for p in records]);return
        if name=='player-invite':
            assert state['kind']=='captain';state['invites'].append(body);player=next(p for p in records if p['id']==body['playerId']);player['captainDetails']['email']=body['email'].lower().strip();player['captainDetails']['revision']+=1
            respond(route,dict(link=BASE+'/login/#test-private-link'));return
        raise AssertionError(name)
    for name in ['get_captain_club','get_member_player_profiles','get_player_directory','save_player_details','save_roster_player','get_player_accounts']:context.route(API+'/rest/v1/rpc/'+name,handler)
    context.route(API+'/functions/v1/player-invite',handler)
    return context,page,state,respond

def directory(page):
    page.goto(BASE+'/players/',wait_until='networkidle');page.get_by_role('button',name='Club directory',exact=True).click();expect(page.locator('.directory-player-card')).to_have_count(16)

def layout(page,width):assert page.evaluate('document.documentElement.scrollWidth')<=width

def card(page,name):return page.locator('.directory-player-card').filter(has=page.get_by_role('heading',name=name,exact=True))

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width in [1440,390,320]:
        context,page,state,_=setup(browser,width=width);directory(page);layout(page,width)
        expect(card(page,names[0])).to_contain_text(CONTACT);expect(card(page,names[0])).to_contain_text(NOTE)
        page.get_by_role('combobox',name='Filter preferred position',exact=True).select_option('Goalkeeper');expect(page.locator('.directory-player-card')).to_have_count(1)
        card(page,'Returning Guest').get_by_role('button',name='Edit player details',exact=True).click()
        editor=page.locator('.directory-details-editor');expect(editor).to_be_visible();expect(editor.get_by_role('checkbox',name='Goalkeeper',exact=True)).to_be_checked();expect(editor.get_by_role('checkbox',name='Right back',exact=True)).to_be_checked()
        editor.get_by_label('Contact email · optional',exact=True).fill('sub@example.test');editor.get_by_label('Phone number · optional',exact=True).fill('+44 7700 900123');editor.get_by_label('How we know this player · optional',exact=True).fill('Friend from the fall league.\nCan play in goal or on the right.');editor.get_by_role('checkbox',name='Right wing',exact=True).check()
        layout(page,width);page.screenshot(path=f'artifacts/player-details-editor-{width}.png',full_page=True)
        before=copy.deepcopy(state['roster']);editor.get_by_role('button',name='Save player details',exact=True).click();expect(editor).to_have_count(0);expect(card(page,'Returning Guest')).to_contain_text('sub@example.test');assert state['roster']==before
        assert state['saves'][-1]['p_details']['preferredPositions']==['Goalkeeper','Right back','Right wing']
        page.get_by_role('combobox',name='Filter preferred position',exact=True).select_option('all');page.get_by_role('textbox',name='Search club directory',exact=True).fill('Tuesday pickup');expect(page.locator('.directory-player-card')).to_have_count(1);expect(card(page,names[0])).to_be_visible();page.get_by_role('textbox',name='Search club directory',exact=True).fill('')
        page.get_by_role('combobox',name='Filter preferred position',exact=True).select_option('unknown');expect(page.locator('.directory-player-card')).to_have_count(14)
        page.get_by_role('combobox',name='Filter preferred position',exact=True).select_option('all');card(page,'Returning Guest').get_by_role('button',name='Edit player details',exact=True).click();state['fail_save']=True;page.locator('.directory-details-editor').get_by_role('button',name='Save player details',exact=True).click();expect(page.locator('.directory-details-editor').get_by_role('alert')).to_contain_text('Player details changed');page.get_by_role('button',name='Reload directory',exact=True).click();expect(page.locator('.directory-details-editor')).to_have_count(0)
        layout(page,width);page.screenshot(path=f'artifacts/player-details-directory-{width}.png',full_page=True)
        # New roster profiles accept optional contact details and all preferred positions.
        page.goto(BASE+'/captain/roster/',wait_until='networkidle');page.get_by_role('button',name='Add player',exact=True).click();form=page.locator('form.management-form');form.get_by_label('Player name',exact=True).fill('New Squad Player');form.get_by_label('Contact email · optional',exact=True).fill('new.player@example.test');form.get_by_label('Phone number · optional',exact=True).fill('212 555 0198');form.get_by_label('How we know this player · optional',exact=True).fill('Recommended by a teammate');form.get_by_role('checkbox',name='Central midfield',exact=True).check();form.get_by_role('checkbox',name='Attacking midfield',exact=True).check()
        expect(form.get_by_role('checkbox',name='Approve this profile for the public club site',exact=True)).not_to_be_checked();layout(page,width);page.screenshot(path=f'artifacts/player-details-roster-{width}.png',full_page=True)
        form.get_by_role('button',name='Save player',exact=True).click();expect(form).to_have_count(0);saved=state['saves'][-1]['p_player'];assert saved['captainDetails']['email']=='new.player@example.test';assert saved['preferredPositions']==['Central midfield','Attacking midfield']
        # Saved contact email prefills an invitation; creating the link saves the chosen email.
        page.goto(BASE+'/captain/access/',wait_until='networkidle');page.get_by_role('combobox',name='Player',exact=True).select_option(saved['id']);expect(page.get_by_role('textbox',name='Player email',exact=True)).to_have_value('new.player@example.test');page.get_by_role('textbox',name='Player email',exact=True).fill('invited@example.test');page.get_by_role('button',name='Create private invite',exact=True).click();expect(page.get_by_role('textbox',name='Private invitation link',exact=True)).to_be_visible();assert state['invites'][-1]['email']=='invited@example.test'
        page.goto(BASE+'/captain/roster/',wait_until='networkidle');page.locator('.management-list button').filter(has_text='New Squad Player').click();expect(page.get_by_label('Contact email · optional',exact=True)).to_have_value('invited@example.test');expect(page.get_by_label('Phone number · optional',exact=True)).to_have_value('212 555 0198');context.close()
    for width in [1440,390,320]:
        context,page,state,_=setup(browser,'player',width);directory(page)
        expect(page.locator('.directory-captain-details')).to_have_count(0);expect(page.get_by_role('button',name='Edit player details',exact=True)).to_have_count(0);assert CONTACT not in page.locator('body').inner_text();assert NOTE not in page.locator('body').inner_text()
        page.get_by_role('combobox',name='Filter preferred position',exact=True).select_option('Right back');expect(page.locator('.directory-player-card')).to_have_count(1);layout(page,width)
        page.goto(BASE+'/players/profile/?id='+ids[0],wait_until='networkidle');expect(page.locator('.profile-preferred-positions')).to_contain_text('Striker');assert CONTACT not in page.locator('body').inner_text();assert NOTE not in page.locator('body').inner_text();layout(page,width);context.close()
    for kind in [None,'outsider']:
        context,page,_,_=setup(browser,kind,390);page.goto(BASE+'/players/',wait_until='networkidle');expect(page.get_by_role('button',name='Club directory',exact=True)).to_have_count(0);page.goto(BASE+'/players/profile/?id='+ids[0],wait_until='networkidle');expect(page.locator('.profile-preferred-positions')).to_have_count(0);assert CONTACT not in page.locator('body').inner_text();assert NOTE not in page.locator('body').inner_text();context.close()
    context,page,state,respond=setup(browser);page.goto(BASE+'/players/',wait_until='networkidle');state['hold_directory']=True;page.get_by_role('button',name='Club directory',exact=True).click()
    for _ in range(100):
        if state['directory_pending']:break
        page.wait_for_timeout(50)
    assert state['directory_pending'];other=context.new_page();other.goto(BASE+'/team/',wait_until='networkidle');other.get_by_role('button',name='Sign out',exact=True).click();expect(page.get_by_role('button',name='Club directory',exact=True)).to_have_count(0)
    for route,value in state['directory_pending']:respond(route,value)
    page.wait_for_timeout(200);expect(page.locator('.directory-captain-details')).to_have_count(0);assert CONTACT not in page.locator('body').inner_text();assert NOTE not in page.locator('body').inner_text();context.close()
    assert not errors,errors
    print('PASS captain enrichment in roster/directory, invitation prefill and capture, stale edit recovery, preferred-position/note search, member/public privacy, sign-out response race and 320/390/1440px layouts; no production writes')
    browser.close()
