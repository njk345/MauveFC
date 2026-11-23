"""Players/profile/directory access and identity races; all services intercepted."""
import copy
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from stats_view_browser import BASE, API, data, S, OLD, ids, names, players, new_context, errors

FORMER='88888888-8888-4888-8888-888888888881';GUEST='88888888-8888-4888-8888-888888888882'
extra=[dict(id=FORMER,name='Former Squad Member',number=20,position='Defender',initials='FM',bio='Past team member',hometown='Brooklyn',isPublic=False),dict(id=GUEST,name='Returning Guest',number=0,position='Forward',initials='RG',bio='Guest player',hometown='',isPublic=False)]

def profile_data():
    result=copy.deepcopy(data);result['players']+=copy.deepcopy(extra);result['roster'].append(dict(seasonId=OLD,playerId=FORMER));return result

def directory_data():
    return [{**p,'rosterSeasonIds':[S,OLD],'guestGames':0,'appearances':1 if i<2 else 0} for i,p in enumerate(players)]+[{**extra[0],'rosterSeasonIds':[OLD],'guestGames':0,'appearances':2},{**extra[1],'rosterSeasonIds':[],'guestGames':2,'appearances':1}]

def context_for(browser,kind='player',width=390):
    context,page,state,respond=new_context(browser,kind,width)
    state.update(profile_calls=0,directory_calls=0,profile_hold=False,directory_hold=False,profile_fail=False,pending=[])
    def profiles(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        state['profile_calls']+=1
        if state['kind'] not in ['captain','player']:respond(route,dict(message='Team membership required'),403);return
        if state['profile_fail']:respond(route,dict(message='Contract failure'),503);return
        value=profile_data()
        if state['profile_hold']:state['profile_hold']=False;state['pending'].append((route,value));return
        respond(route,value)
    def directory(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        state['directory_calls']+=1
        if state['kind'] not in ['captain','player']:respond(route,dict(message='Team membership required'),403);return
        value=directory_data()
        if state['directory_hold']:state['directory_hold']=False;state['pending'].append((route,value));return
        respond(route,value)
    context.route(API+'/rest/v1/rpc/get_member_player_profiles',profiles)
    context.route(API+'/rest/v1/rpc/get_player_directory',directory)
    return context,page,state,respond

def layout(page,width):assert page.evaluate('document.documentElement.scrollWidth')<=width

def wait_pending(page,state):
    for _ in range(100):
        if state['pending']:return
        page.wait_for_timeout(50)
    raise AssertionError('Expected a held private response')

def no_private(page):
    text=page.locator('main').inner_text()
    for name in [names[1],*names[2:],'Former Squad Member','Returning Guest']:assert name not in text,name

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    players[0]['isPublic']=False
    for kind in ['player','captain']:
        context,page,state,_=context_for(browser,kind);state['all_private']=True
        for width in [1440,390,320]:
            page.set_viewport_size(dict(width=width,height=1000));page.goto(BASE+'/players/',wait_until='networkidle')
            expect(page.locator('.player-card')).to_have_count(15);expect(page.locator('.player-grid')).to_contain_text(names[1]);layout(page,width)
            page.screenshot(path=f'artifacts/member-players-{kind}-{width}.png',full_page=True)
            page.get_by_role('textbox',name='Search players',exact=True).fill('Alexandra');expect(page.locator('.player-card')).to_have_count(1)
            page.get_by_role('combobox',name='Filter by position',exact=True).select_option('Forward');expect(page.locator('.player-card')).to_have_count(0)
            page.get_by_role('button',name='Clear filters',exact=True).click();expect(page.locator('.player-card')).to_have_count(15)
            page.locator('.player-card').filter(has_text=names[1]).click();expect(page.get_by_role('heading',name=names[1],exact=True)).to_be_visible()
            totals=page.locator('.profile-totals strong');expect(totals.nth(0)).to_have_text('1');expect(totals.nth(1)).to_have_text('2');expect(totals.nth(2)).to_have_text('4');expect(page.locator('.appearance-row')).to_have_count(1);layout(page,width)
            page.screenshot(path=f'artifacts/member-profile-{kind}-{width}.png',full_page=True)
            page.locator('.back-link').click();page.get_by_role('button',name='Club directory',exact=True).click()
            expect(page.locator('.directory-player-card')).to_have_count(17);expect(page.get_by_role('heading',name='Club player directory',exact=True)).to_be_visible();layout(page,width)
            page.get_by_role('textbox',name='Search club directory',exact=True).fill('Returning');expect(page.locator('.directory-player-card')).to_have_count(1);expect(page.locator('.directory-player-card')).to_contain_text('2 guest game assignments')
            page.get_by_role('textbox',name='Search club directory',exact=True).fill('');page.get_by_role('combobox',name='Filter player directory',exact=True).select_option('past');expect(page.locator('.directory-player-card')).to_have_count(1);expect(page.locator('.directory-player-card')).to_contain_text('Former Squad Member')
            page.get_by_role('combobox',name='Filter player directory',exact=True).select_option('roster');expect(page.locator('.directory-player-card')).to_have_count(15)
            page.screenshot(path=f'artifacts/member-directory-{kind}-{width}.png',full_page=True)
            page.get_by_role('button',name='Season profiles',exact=True).click();page.get_by_role('combobox',name='Season',exact=True).select_option(OLD);expect(page.locator('.player-card')).to_have_count(16);expect(page.locator('.player-grid')).to_contain_text('Former Squad Member');page.get_by_role('combobox',name='Season',exact=True).select_option(S)
            page.goto(BASE+'/',wait_until='networkidle');no_private(page)
        assert state['profile_calls'] and state['directory_calls'];context.close()
    players[0]['isPublic']=True
    for kind in [None,'outsider']:
        context,page,state,_=context_for(browser,kind)
        for all_private in [False,True]:
            state['all_private']=all_private
            for width in [1440,390,320]:
                page.set_viewport_size(dict(width=width,height=1000));page.goto(BASE+'/players/',wait_until='networkidle')
                expect(page.locator('.player-card')).to_have_count(0 if all_private else 1);expect(page.get_by_role('button',name='Club directory',exact=True)).to_have_count(0);no_private(page);layout(page,width)
                page.goto(BASE+'/players/profile/?id='+ids[1],wait_until='networkidle');expect(page.get_by_role('heading',name='Player not found.',exact=True)).to_be_visible();no_private(page)
        assert state['profile_calls']==0 and state['directory_calls']==0;context.close()
    # Retry a member-only read failure without showing incorrect zero stats.
    context,page,state,_=context_for(browser);state['profile_fail']=True
    page.goto(BASE+'/players/',wait_until='networkidle');expect(page.get_by_role('button',name='Retry profiles',exact=True)).to_be_visible();expect(page.locator('.player-card')).to_have_count(0)
    state['profile_fail']=False;page.get_by_role('button',name='Retry profiles',exact=True).click();expect(page.locator('.player-card')).to_have_count(15);context.close()
    # Pending private responses cannot repopulate the page after a real sign-out
    # in another tab. Exercise both profile and directory reads.
    for hold in ['profile_hold','directory_hold']:
        context,page,state,respond=context_for(browser);state['all_private']=True
        if hold=='profile_hold':
            state[hold]=True;page.goto(BASE+'/players/',wait_until='domcontentloaded');wait_pending(page,state)
        else:
            page.goto(BASE+'/players/',wait_until='networkidle');state[hold]=True;page.get_by_role('button',name='Club directory',exact=True).click();wait_pending(page,state)
        other=context.new_page();other.goto(BASE+'/team/',wait_until='networkidle');other.get_by_role('button',name='Sign out',exact=True).click()
        expect(page.get_by_role('button',name='Club directory',exact=True)).to_have_count(0)
        for route,value in state['pending']:respond(route,value)
        state['pending'].clear();page.wait_for_timeout(250);no_private(page);expect(page.locator('.player-card')).to_have_count(0);context.close()
    # Membership revocation is rechecked when the page regains focus.
    context,page,state,_=context_for(browser);page.goto(BASE+'/players/',wait_until='networkidle');expect(page.locator('.player-card')).to_have_count(15)
    state['kind']='outsider';page.evaluate('window.dispatchEvent(new Event("focus"))');expect(page.get_by_role('button',name='Club directory',exact=True)).to_have_count(0);expect(page.locator('.player-card')).to_have_count(1);no_private(page);context.close()
    assert not errors,errors
    print('PASS member/captain private roster and profiles, published totals/history, directory search/filters, public/outsider privacy, retries, sign-out response races, revocation and 320/390/1440px layouts; no production writes')
    browser.close()
