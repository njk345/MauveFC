"""Season details and deletion; synthetic APIs only, no production mutations."""
import copy
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from stats_view_browser import API, BASE, OLD, S, data, errors, ids, names, new_context

initial = copy.deepcopy(data)
initial['seasons'][0].update(name='Fall 2026', competition='NYC Soccer', year=2026, term='Fall', teamName='Current FC', format='7v7 coed', source='leagueapps', location='', timeZone='America/New_York', settingsRevision=0)
initial['seasons'][1].update(name='Spring 2025 · NYC Footy', competition='NYC Footy', year=2025, term='Spring', teamName='Historical FC', source='leagueapps', location='Pitch', timeZone='America/New_York', settingsRevision=0)
old_match = copy.deepcopy(initial['matches'][0])
old_match.update(id='77777777-7777-4777-8777-777777777779', seasonId=OLD, opponent='Historical Opponent')
old_match['result']['stats'] = [dict(playerId=ids[2], appeared=True, goals=5, assists=1)]
initial['matches'].append(old_match)
initial['roster'] = [dict(seasonId=s, playerId=p) for s,p in [(S,ids[0]),(S,ids[1]),(OLD,ids[1]),(OLD,ids[2])]]


def setup(browser, width=1440, role='captain'):
    data.clear(); data.update(copy.deepcopy(initial))
    context, page, state, respond = new_context(browser, role, width)
    state.update(edits=[], deletions=[], fail=False)

    def edit(route):
        if route.request.method == 'OPTIONS': respond(route,None); return
        assert state['kind']=='captain'
        b=route.request.post_data_json
        season=next(s for s in data['seasons'] if s['id']==b['p_season_id'])
        assert b['p_expected_revision']==season['settingsRevision']
        if state['fail']: respond(route,dict(code='40001',message='Season details changed. Reload before saving.'),409); return
        details=b['p_details']; state['edits'].append(b)
        season.update(details)
        season.update(name=details['name'].strip() or f"{details['term']} {details['year']}",settingsRevision=season['settingsRevision']+1)
        respond(route,None)

    def delete(route):
        if route.request.method == 'OPTIONS': respond(route,None); return
        assert state['kind']=='captain'
        b=route.request.post_data_json; state['deletions'].append(b)
        season=next(s for s in data['seasons'] if s['id']==b['p_season_id'])
        assert b['p_expected_revision']==season['settingsRevision']
        assert b['p_confirmation'].strip()==season['name']
        data['seasons'][:]=[s for s in data['seasons'] if s['id']!=season['id']]
        data['matches'][:]=[m for m in data['matches'] if m['seasonId']!=season['id']]
        data['roster'][:]=[r for r in data['roster'] if r['seasonId']!=season['id']]
        respond(route,None)

    def directory(route):
        if route.request.method=='OPTIONS': respond(route,None);return
        respond(route,[{**p,'rosterSeasonIds':[r['seasonId'] for r in data['roster'] if r['playerId']==p['id']],
            'guestGames':0,'appearances':sum(1 for m in data['matches'] if any(s['playerId']==p['id'] and s['appeared'] for s in m.get('result',{}).get('stats',[])))} for p in data['players']])

    context.route(API+'/rest/v1/rpc/update_season_details',edit)
    context.route(API+'/rest/v1/rpc/delete_club_season',delete)
    context.route(API+'/rest/v1/rpc/get_player_directory',directory)
    return context,page,state


def fill(form):
    form.get_by_label('League name',exact=True).fill('Updated league')
    form.get_by_label('League location · optional',exact=True).fill('New York')
    form.get_by_label('Team name for this season',exact=True).fill('Winter Mauve')
    form.get_by_label('Playing format',exact=True).fill('8v8 coed')
    form.get_by_label('Year',exact=True).fill('2027')
    form.get_by_role('combobox',name='Season of year',exact=True).select_option('Winter')
    form.get_by_role('combobox',name=re.compile('^Time zone')).fill('America/Los_Angeles')
    form.get_by_label('League website · optional',exact=True).fill('https://example.test/league')


def confirm(page, name):
    page.get_by_role('button',name='Delete season',exact=True).click()
    form=page.get_by_role('form',name='Confirm season deletion',exact=True)
    form.get_by_role('textbox').fill(name)
    form.get_by_role('button',name='Permanently delete season',exact=True).click()


def layout(page,width): assert page.evaluate('document.documentElement.scrollWidth')<=width,(width,page.url)


if __name__=='__main__':
    Path('artifacts').mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        for width in [1440,390,320]:
            context,page,state=setup(browser,width)
            page.goto(BASE+'/captain/season/',wait_until='networkidle')
            selector=page.get_by_role('combobox',name='Season',exact=True)
            expect(selector.locator('option:checked')).to_have_text('Fall 2026 · NYC Soccer')
            form=page.get_by_role('form',name='Season details',exact=True)
            expect(form.get_by_role('textbox',name=re.compile('^Season label'))).to_have_value('')
            fill(form)
            form.get_by_role('combobox',name=re.compile('^Time zone')).fill('Not/A_Zone')
            form.get_by_role('button',name='Save season details',exact=True).click()
            expect(form.get_by_role('alert')).to_contain_text('valid IANA time zone')
            assert not state['edits']
            fill(form);state['fail']=True
            form.get_by_role('button',name='Save season details',exact=True).click()
            expect(form.get_by_role('alert')).to_contain_text('Season details changed.')
            state['fail']=False
            form.get_by_role('button',name='Reload season details',exact=True).click()
            expect(form.get_by_role('alert')).to_have_count(0)
            fill(form)
            form.get_by_role('button',name='Save season details',exact=True).click()
            expect(selector.locator('option:checked')).to_have_text('Winter 2027 · Updated league')
            expect(form.get_by_label('League name',exact=True)).to_have_value('Updated league')
            expect(form.get_by_label('Playing format',exact=True)).to_have_value('8v8 coed')
            assert data['matches']==initial['matches']
            form.get_by_role('textbox',name=re.compile('^Season label')).fill('The comeback')
            form.get_by_role('button',name='Save season details',exact=True).click()
            expect(selector.locator('option:checked')).to_have_text('The comeback · Updated league')
            page.screenshot(path=f'artifacts/season-properties-{width}.png',full_page=True)
            layout(page,width)
            page.get_by_role('button',name='Delete season',exact=True).click()
            deletion=page.get_by_role('form',name='Confirm season deletion',exact=True)
            deletion.get_by_role('textbox').fill('wrong season')
            expect(deletion.get_by_role('button',name='Permanently delete season',exact=True)).to_be_disabled()
            selector.select_option(OLD)
            expect(deletion).to_have_count(0)
            expect(form.get_by_label('League name',exact=True)).to_have_value('NYC Footy')
            selector.select_option(S)
            confirm(page,'The comeback')
            expect(selector).to_have_value(OLD)
            expect(selector.locator(f'option[value="{S}"]')).to_have_count(0)
            assert data['players']==initial['players']
            assert len(state['deletions'])==1
            page.goto(BASE+'/players/profile/?id='+ids[0],wait_until='networkidle')
            expect(page.locator('h1')).to_contain_text(names[0])
            expect(page.locator('.appearance-row')).to_have_count(0)
            page.goto(BASE+'/players/',wait_until='networkidle')
            page.get_by_role('button',name='Club directory',exact=True).click()
            expect(page.locator('.player-directory')).to_contain_text(names[0])
            page.goto(BASE+'/captain/season/',wait_until='networkidle')
            page.get_by_role('combobox',name='Season',exact=True).select_option(OLD)
            confirm(page,'Spring 2025 · NYC Footy')
            expect(page.get_by_role('combobox',name='Season',exact=True)).to_be_disabled()
            expect(page.get_by_role('button',name='Add a season',exact=True)).to_be_visible()
            expect(page.locator('main')).to_contain_text('All players remain in your club directory.')
            assert not data['seasons'] and not data['matches'] and not data['roster']
            assert data['players']==initial['players']
            page.screenshot(path=f'artifacts/empty-seasons-{width}.png',full_page=True)
            layout(page,width)
            for route in ['/','/schedule/','/results/','/stats/','/team/']:
                page.goto(BASE+route,wait_until='networkidle')
                expect(page.locator('main')).to_contain_text('A new season awaits.')
                layout(page,width)
            page.goto(BASE+'/players/',wait_until='networkidle')
            page.get_by_role('button',name='Club directory',exact=True).click()
            expect(page.locator('.player-directory')).to_contain_text(names[0])
            page.goto(BASE+'/captain/season/',wait_until='networkidle')
            page.get_by_role('button',name='Add a season',exact=True).click()
            expect(page.get_by_role('button',name='Continue',exact=True)).to_be_visible()
            context.close()
        for role in [None,'player','outsider']:
            context,page,_=setup(browser,390,role)
            page.goto(BASE+'/captain/season/',wait_until='networkidle')
            expect(page.get_by_role('form',name='Season details',exact=True)).to_have_count(0)
            expect(page.get_by_role('button',name='Delete season',exact=True)).to_have_count(0)
            context.close()
        assert not errors,errors
        browser.close()
        print('PASS season labels, all metadata fields, validation, stale/reload/retry, switching, confirmation and deletion, profile/stat cleanup with directory preserved, empty-club pages and new-season setup, captain guards, 1440/390/320px; no production mutations.')
