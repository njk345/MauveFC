"""Team-based division selection, preview races and import. All services intercepted."""
import copy
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from stats_view_browser import BASE,API,data,new_context,errors

LINK='https://nycfooty.leagueapps.com/leagues/soccer-(indoor)/4786186-2026-winter--thursdays--prospect-heights-chelsea-piers-field-house--5v5-coed--p4'
A='7647530';B='7639924';DUP='7651445'

def setup(browser,width):
    context,page,state,respond=new_context(browser,'captain',width)
    snapshot=copy.deepcopy(data);state.update(hold=False,pending=[],calls=[],saved=None)
    def preview(team):
        division='Division A' if team==A else 'Division B';name="It's Coming Home" if team==A else 'Gabaghoul FC'
        rows=[dict(position=1,teamId=team,name=name,played=1,wins=1,losses=0,draws=0,goalsFor=2,goalsAgainst=1,difference=1,forfeits=0,points=3,divisionName=division),dict(position=2,teamId='other-'+team,name='Division Opponent '+division[-1],played=1,wins=0,losses=1,draws=0,goalsFor=1,goalsAgainst=2,difference=-1,forfeits=0,points=0,divisionName=division)]
        return dict(phase='ready',previewId='preview-'+team,teamName=name,divisionName=division,expiresAt='2099-01-01T00:00:00Z',source=dict(origin='https://nycfooty.leagueapps.com',programId='4786186',teamId=team),standings=rows,games=[dict(externalId='1',opponent=rows[1]['name'],kickoff='2026-01-15T20:00:00Z',venue='Test Pitch',status='completed',score=dict(home=2,away=1,basis='played'))])
    def handler(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        body=route.request.post_data_json or {};name=route.request.url.split('/')[-1]
        if name=='season-import':
            state['calls'].append(body);assert body['link']==LINK
            result=preview(body['teamId']) if body['teamId'] else dict(phase='choose-team',origin='https://nycfooty.leagueapps.com',programId='4786186',teams=[dict(teamId=A,name="It's Coming Home",divisionName='Division A'),dict(teamId=B,name='Gabaghoul FC',divisionName='Division B'),dict(teamId=DUP,name="It's Coming Home",divisionName='Division B')])
            if state['hold']:state['hold']=False;state['pending'].append((route,result));return
            respond(route,result);return
        if name=='create_club_season':
            value=body['p_input'];assert body['p_preview_id']=='preview-'+A;assert value['teamName']=="It's Coming Home";state['saved']=copy.deepcopy(body)
            source=preview(A);snapshot['seasons'].append({**value,'source':'leagueapps','name':'Winter 2026 · NYC Footy','revision':0,'completed':False})
            snapshot['leagues']=[dict(kind='leagueapps',seasonId=value['id'],teamId=A,teamName=value['teamName'],standings=source['standings'],state='succeeded',lastSuccess='2026-11-25T20:00:00Z',lastAttempt=None,error=None)]
            respond(route,value['id']);return
        if name=='get_captain_club':respond(route,snapshot);return
        raise AssertionError(name)
    context.route(API+'/functions/v1/season-import',handler)
    context.route(API+'/rest/v1/rpc/create_club_season',handler)
    context.route(API+'/rest/v1/rpc/get_captain_club',handler)
    return context,page,state,respond

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width in [1440,390,320]:
        context,page,state,respond=setup(browser,width)
        page.goto(BASE+'/captain/season/',wait_until='networkidle');page.get_by_role('button',name='Add a season',exact=True).click();form=page.locator('.season-setup-form')
        form.get_by_role('radio',name=re.compile('^Import from LeagueApps')).check();form.get_by_label('Year',exact=True).fill('2026');form.get_by_label('League name',exact=True).fill('NYC Footy');form.get_by_label('League location',exact=True).fill('Prospect Heights, Brooklyn');form.get_by_role('button',name='Continue',exact=True).click();form.get_by_label('LeagueApps team, schedule or standings link',exact=True).fill(LINK);form.get_by_role('button',name='Read league link',exact=True).click()
        selector=form.get_by_role('combobox',name='Choose your LeagueApps team',exact=True);expect(selector).to_be_visible();expect(selector.locator('option')).to_have_text(['Select a team',"It's Coming Home · Division A",'Gabaghoul FC · Division B',"It's Coming Home · Division B"])
        selector.select_option(B);form.get_by_role('button',name='Preview this team',exact=True).click();expect(form.locator('.season-import-preview')).to_contain_text('Standings from Division B');form.locator('.season-preview-standings summary').click();expect(form.locator('.season-preview-standings tbody')).to_contain_text('Gabaghoul FC');expect(form.locator('.season-preview-standings tbody')).not_to_contain_text('Division Opponent A')
        # A held B refresh must not overwrite the A selection and its preview.
        state['hold']=True;form.get_by_role('button',name='Refresh preview',exact=True).click()
        for _ in range(100):
            if state['pending']:break
            page.wait_for_timeout(30)
        assert state['pending'];selector.select_option(A);form.get_by_role('button',name='Preview this team',exact=True).click();expect(form.locator('.season-import-preview')).to_contain_text('Standings from Division A')
        for route,result in state['pending']:respond(route,result)
        state['pending'].clear();page.wait_for_timeout(150);expect(form.locator('.season-import-preview')).to_contain_text('Standings from Division A');expect(selector).to_have_value(A)
        form.locator('.season-preview-standings summary').click();expect(form.locator('.season-preview-standings tbody tr')).to_have_count(2);expect(form.locator('.season-preview-standings tbody')).not_to_contain_text('Gabaghoul FC')
        assert page.evaluate('document.documentElement.scrollWidth')<=width;page.screenshot(path=f'artifacts/leagueapps-divisions-{width}.png',full_page=True)
        form.get_by_role('button',name='Continue',exact=True).click();expect(form.locator('.season-review')).to_contain_text("It's Coming Home");expect(form.locator('.season-review')).not_to_contain_text('Gabaghoul FC');form.get_by_role('button',name='Save season',exact=True).click();expect(page.locator('.season-saved')).to_contain_text('Your season is saved.');assert state['saved']['p_preview_id']=='preview-'+A
        page.get_by_role('link',name='View season',exact=True).click();expect(page.locator('.home-standings')).to_contain_text('Division A');expect(page.locator('.home-standings-table tbody tr')).to_have_count(2);expect(page.locator('.home-standings')).not_to_contain_text('Gabaghoul FC');context.close()
    assert not errors,errors
    print('PASS division-labelled team selection, automatic standings selection, stale-response protection, corrected auto-filled team name, import and Home table at 320/390/1440px; no production writes')
    browser.close()
