"""Multi-season creation, import preview and manual standings. All APIs intercepted."""
import copy
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from stats_view_browser import BASE,API,C,S,ids,names,data,new_context,errors

ORIGIN='https://nycfooty.leagueapps.com'

def setup(browser,width=1440,kind='captain'):
    context,page,state,respond=new_context(browser,kind,width)
    current=copy.deepcopy(data);current['seasons']=current['seasons'][:1];current['seasons'][0].update(source='leagueapps',year=2026,term='Fall',teamName='Current FC',location='Brooklyn',settingsRevision=0)
    current['leagues']=[dict(kind='leagueapps',seasonId=S,teamId='current',teamName='Current FC',leagueName='Current league',standings=[],state='idle',lastSuccess=None,lastAttempt=None,error=None,scheduleUrl='https://nycsoccer.leagueapps.com/leagues/1/schedule',standingsUrl='https://nycsoccer.leagueapps.com/leagues/1/standings')]
    current['roster']=[r for r in current['roster'] if r['seasonId']==S]
    state.update(snapshot=current,created=[],preview_calls=[],manual_results={},hold_preview=False,pending_previews=[])
    imported=[dict(externalId='101',opponent='Past Opposition',kickoff='2023-10-01T20:00:00Z',venue='Pitch',status='completed',score=dict(home=2,away=1,basis='played')),dict(externalId='102',opponent='Opponent TBD',kickoff=None,venue='Pitch',status='scheduled',score=None)]
    official=[dict(position=1,teamId='other',name='Past Opposition',played=2,wins=1,losses=0,draws=1,goalsFor=4,goalsAgainst=1,difference=3,forfeits=0,points=4),dict(position=2,teamId='42',name='Footy History FC',played=2,wins=1,losses=1,draws=0,goalsFor=3,goalsAgainst=4,difference=-1,forfeits=0,points=3)]
    def read(captain=False):
        value=copy.deepcopy(current)
        if not captain:
            value['players']=[p for p in value['players'] if p['isPublic']];value['roster']=[r for r in value['roster'] if r['playerId']==ids[0]]
        return value
    def manual_table(season):
        records=state['manual_results'].get(season['id'],[])
        rows=[dict(position=i+1,teamId=t['id'],name=t['name'],played=0,wins=0,losses=0,draws=0,goalsFor=0,goalsAgainst=0,difference=0,forfeits=0,points=0) for i,t in enumerate(season['leagueTeams'])]
        if records:
            r=records[0];row=next(t for t in rows if t['teamId']==r['homeTeamId']);row.update(points=3,played=1,wins=1,goalsFor=r['home'],goalsAgainst=r['away'],difference=r['home']-r['away']);rows.sort(key=lambda t:-t['points'])
        for i,r in enumerate(rows):r['position']=i+1
        return rows
    def connect_manual(season):
        current['leagues']=[l for l in current['leagues'] if l['seasonId']!=season['id']]
        if season['manualStandings']:current['leagues'].append(dict(kind='manual',seasonId=season['id'],teamId=season['leagueTeams'][0]['id'],teamName=season['teamName'],leagueName=season['competition'],standings=manual_table(season),lastSuccess=None,lastAttempt=None,error=None,state='idle',unmatchedGames=0))
    def handler(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        b=route.request.post_data_json or {};name=route.request.url.split('/')[-1]
        if name in ['get_public_club','get_captain_club','get_member_player_profiles']:respond(route,read(name=='get_captain_club'));return
        if name=='create_club_season':
            assert state['kind']=='captain';i=copy.deepcopy(b['p_input']);state['created'].append(i);sid=i['id'];season={**i,'name':i['name'] or f"{i['term']} {i['year']} · {i['competition']}",'revision':1 if i['completed'] else 0,'settingsRevision':0,'finalPosition':2 if i['source']=='leagueapps' and i['completed'] else None,'completedAt':'2026-11-23T20:00:00Z' if i['completed'] else None}
            if i['source']=='manual':
                assert b['p_preview_id'] is None
                season['leagueTeams']=[dict(id=f'{sid}-{idx}',name=name,isOurs=idx==0) for idx,name in enumerate([i['teamName']]+i['teams'])];connect_manual(season)
            else:
                assert b['p_preview_id']=='private-preview-42';season['leagueTeams']=[];current['leagues'].append(dict(kind='leagueapps',seasonId=sid,teamId='42',teamName='Footy History FC',leagueName=i['competition'],standings=official,lastSuccess='2026-11-23T20:00:00Z',lastAttempt=None,error=None,state='succeeded',scheduleUrl=ORIGIN+'/leagues/999/schedule',standingsUrl=ORIGIN+'/leagues/999/standings',refreshesAutomatically=False))
                for index,g in enumerate(imported):
                    match=dict(id='import-'+sid+str(index),seasonId=sid,opponent=g['opponent'],opponentCode='PO',color='#657293',kickoff=g['kickoff'],venue=g['venue'],round=index+1,home=True,status=g['status'],revision=0,source='leagueapps')
                    if g['score']:match['result']={**g['score'],'onFieldHome':2,'onFieldAway':1,'reason':'','attendance':'unrecorded','scorers':'unrecorded','assists':'unrecorded','ownGoals':0,'published':True,'stats':[]}
                    current['matches'].append(match)
            current['seasons'].append(season);current['roster'] += [dict(seasonId=sid,playerId=p) for p in i['rosterPlayerIds']];state['manual_results'][sid]=[];respond(route,sid);return
        if name=='season-import':
            state['preview_calls'].append(b);assert b['clubId']==C and b['link'].startswith(ORIGIN)
            if not b['teamId'] and '/teams/' not in b['link']:value=dict(phase='choose-team',teams=[dict(teamId='42',name='Footy History FC'),dict(teamId='other',name='Past Opposition')],origin=ORIGIN,programId='999')
            else:value=dict(phase='ready',previewId='private-preview-42',teamName='Footy History FC',expiresAt='2099-01-01T00:00:00Z',source=dict(origin=ORIGIN,programId='999',teamId='42'),games=imported,standings=official)
            if state['hold_preview']:state['hold_preview']=False;state['pending_previews'].append((route,value));return
            respond(route,value);return
        if name=='get_manual_league_results':respond(route,state['manual_results'][b['p_season_id']]);return
        if name=='write_manual_league_result':
            r=b['p_result'];sid=b['p_season_id'];records=state['manual_results'][sid];records[:]=[v for v in records if v['id']!=r['id']]
            if not b['p_remove']:records.append({**r,'revision':r['revision']+1})
            connect_manual(next(s for s in current['seasons'] if s['id']==sid));respond(route,r['id']);return
        if name=='configure_manual_standings':
            season=next(s for s in current['seasons'] if s['id']==b['p_season_id']);assert season['settingsRevision']==b['p_expected_revision'];season['manualStandings']=b['p_enabled'];season['settingsRevision']+=1
            for index,n in enumerate(b['p_team_names']):season['leagueTeams'].append(dict(id='extra-'+str(index),name=n,isOurs=False))
            connect_manual(season);respond(route,None);return
        raise AssertionError(name)
    for name in ['get_public_club','get_captain_club','get_member_player_profiles','create_club_season','get_manual_league_results','write_manual_league_result','configure_manual_standings']:context.route(API+'/rest/v1/rpc/'+name,handler)
    context.route(API+'/functions/v1/season-import',handler)
    return context,page,state,respond

def layout(page,width):assert page.evaluate('document.documentElement.scrollWidth')<=width

def start(page,source='manual',year='2024',team='Historic FC'):
    page.get_by_role('button',name='Add a season',exact=True).click();form=page.locator('.season-setup-form')
    if source=='leagueapps':form.get_by_role('radio',name=re.compile('^Import from LeagueApps')).check()
    form.get_by_label('Year',exact=True).fill(year)
    if team:form.get_by_label(re.compile('^Team name this season')).fill(team)
    form.get_by_label('League name',exact=True).fill('Historic League' if source=='manual' else 'NYC Footy');form.get_by_label('League location',exact=True).fill('Brooklyn, New York');form.get_by_role('button',name='Continue',exact=True).click();return form

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width in [1440,390,320]:
        context,page,state,_=setup(browser,width);page.goto(BASE+'/captain/season/',wait_until='networkidle');form=start(page)
        expect(form.get_by_role('combobox',name='Construct manual standings',exact=True)).to_have_value('no');form.get_by_role('combobox',name='Construct manual standings',exact=True).select_option('yes');form.get_by_label('Other teams in this league · one per line',exact=True).fill('Team A\nTeam B')
        form.get_by_label('Find existing club players',exact=True).fill(names[2]);form.get_by_role('checkbox',name=names[2],exact=True).check();form.get_by_role('button',name='Continue',exact=True).click();expect(form.locator('.season-review')).to_contain_text('3 teams');expect(form.locator('.season-review')).to_contain_text('1 existing player selected');layout(page,width);page.screenshot(path=f'artifacts/season-manual-review-{width}.png',full_page=True)
        form.get_by_role('button',name='Save season',exact=True).click();expect(page.locator('.season-saved')).to_contain_text('Your season is saved.');sid=state['created'][-1]['id'];expect(page.get_by_role('combobox',name='Season',exact=True)).to_have_value(sid);assert state['created'][-1]['rosterPlayerIds']==[ids[2]]
        page.get_by_role('link',name='View season',exact=True).click();expect(page.locator('.home-standings-table')).to_contain_text('Team A');expect(page.locator('.standings-note')).to_contain_text('Partial league record');expect(page.locator('.home-season-summary')).to_contain_text('0');layout(page,width)
        page.goto(BASE+'/captain/season/',wait_until='networkidle');expect(page.get_by_role('combobox',name='Season',exact=True)).to_have_value(sid);panel=page.locator('.manual-season-panel');panel.get_by_role('button',name='Add league result',exact=True).click();other=panel.locator('.manual-league-result-form');other.get_by_label('Home goals',exact=True).fill('9');other.get_by_label('Away goals',exact=True).fill('0');other.get_by_role('button',name='Save league result',exact=True).click();expect(panel.locator('.manual-league-result-list')).to_contain_text('Team A 9–0 Team B');layout(page,width);page.screenshot(path=f'artifacts/season-manual-tools-{width}.png',full_page=True)
        page.goto(BASE+'/',wait_until='networkidle');expect(page.locator('.home-standings-table tbody tr').first).to_contain_text('Team A');expect(page.locator('.home-season-summary')).to_contain_text('0');assert not any(m['seasonId']==sid for m in state['snapshot']['matches'])
        # Imported season: a standings URL first discovers teams, then previews a team.
        page.goto(BASE+'/captain/season/',wait_until='networkidle');form=start(page,'leagueapps','2023','');form.get_by_label('LeagueApps team, schedule or standings link',exact=True).fill(ORIGIN+'/leagues/999/standings');form.get_by_role('button',name='Read league link',exact=True).click();form.get_by_role('combobox',name='Choose your LeagueApps team',exact=True).select_option('42');form.get_by_role('button',name='Preview this team',exact=True).click();expect(form.locator('.season-import-preview')).to_contain_text('2 fixtures · 1 final result · 2 league teams');expect(form.locator('.season-import-preview')).to_contain_text('Opponent TBD');form.locator('.season-preview-standings summary').click();expect(form.locator('.season-preview-standings tbody tr')).to_have_count(2);assert form.locator('.season-preview-standings th[scope=row]').first.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)')>=14;layout(page,width);page.screenshot(path=f'artifacts/season-feed-preview-{width}.png',full_page=True)
        form.get_by_role('button',name='Continue',exact=True).click();expect(form.locator('.season-review')).to_contain_text('Official league table');form.get_by_role('button',name='Save season',exact=True).click();expect(page.locator('.season-saved')).to_contain_text('Your season is saved.');feed_id=state['created'][-1]['id'];expect(page.get_by_role('combobox',name='Season',exact=True)).to_have_value(feed_id);page.get_by_role('link',name='View season',exact=True).click();expect(page.locator('.home-standings-table')).to_contain_text('Footy History FC');expect(page.get_by_role('link',name='League table',exact=True)).to_have_attribute('href',ORIGIN+'/leagues/999/standings');expect(page.locator('.home-season-context')).to_contain_text('Footy History FC');layout(page,width)
        page.goto(BASE+'/schedule/',wait_until='networkidle');expect(page.get_by_role('link',name='View league source',exact=True)).to_have_attribute('href',ORIGIN+'/leagues/999/schedule');page.get_by_role('button',name=re.compile('^All matches')).click();expect(page.locator('main')).to_contain_text('Past Opposition');expect(page.locator('main')).not_to_contain_text('Past United')
        page.get_by_role('combobox',name='Season',exact=True).select_option(S);expect(page.locator('main')).to_contain_text('Past United');expect(page.locator('main')).not_to_contain_text('Past Opposition');context.close()
    # Season changes close stale fixture/roster editors; local kickoff follows the selected season.
    context,page,state,respond=setup(browser,390)
    local_id='99999999-9999-4999-8999-999999999991'
    state['snapshot']['seasons'].append(dict(id=local_id,name='Summer 2024 · Pacific League',competition='Pacific League',format='7v7',source='manual',year=2024,term='Summer',teamName='Pacific FC',location='Los Angeles',timeZone='America/Los_Angeles',leagueWebsite='',manualStandings=False,settingsRevision=0,leagueTeams=[]))
    saved=[]
    def fixture(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        value=route.request.post_data_json['p_fixture'];saved.append(value);assert value['seasonId']==local_id;assert value['kickoff']=='2024-07-02T02:00:00.000Z';state['snapshot']['matches'].append({**value,'revision':0});respond(route,value['id'])
    context.route(API+'/rest/v1/rpc/save_fixture',fixture)
    page.goto(BASE+'/captain/fixtures/',wait_until='networkidle');page.locator('.management-list button').first.click();expect(page.locator('form.management-form')).to_be_visible();page.get_by_role('combobox',name='Season',exact=True).select_option(local_id);expect(page.locator('form.management-form')).to_have_count(0)
    page.get_by_role('button',name='Add fixture',exact=True).click();form=page.locator('form.management-form');form.get_by_label('Opponent',exact=True).fill('Pacific Opposition');form.get_by_label('Short code',exact=True).fill('PO');form.get_by_label('Venue',exact=True).fill('Test Pitch');form.get_by_label(re.compile('^Kickoff')).fill('2024-07-01T19:00');form.get_by_role('button',name='Save fixture',exact=True).click();expect(form).to_have_count(0);assert len(saved)==1
    page.goto(BASE+'/captain/roster/',wait_until='networkidle');page.get_by_role('button',name='Add player',exact=True).click();expect(page.locator('form.management-form')).to_be_visible();page.get_by_role('combobox',name='Season',exact=True).select_option(S);expect(page.locator('form.management-form')).to_have_count(0);context.close()
    # Standings-off path never leaks the last viewed season's league table.
    context,page,state,_=setup(browser);page.goto(BASE+'/captain/season/',wait_until='networkidle');form=start(page,year='2022');expect(form.get_by_role('combobox',name='Construct manual standings',exact=True)).to_have_value('no');form.get_by_role('button',name='Continue',exact=True).click();form.get_by_role('button',name='Save season',exact=True).click();expect(page.locator('.season-saved')).to_contain_text('Your season is saved.');page.get_by_role('link',name='View season',exact=True).click();expect(page.locator('.home-standings-table')).to_have_count(0);expect(page.locator('.home-standings')).to_contain_text('League standings are optional');context.close()
    for kind in [None,'player','outsider']:
        context,page,_,_=setup(browser,390,kind);page.goto(BASE+'/captain/season/',wait_until='networkidle');expect(page.get_by_role('button',name='Add a season',exact=True)).to_have_count(0);context.close()
    assert not errors,errors
    print('PASS manual setup/default-off standings, historical roster selection, other-team result entry without club fixtures, LeagueApps team discovery/preview/import, source links, selector persistence/isolation, role guards and 320/390/1440px layouts; no production writes')
    browser.close()
