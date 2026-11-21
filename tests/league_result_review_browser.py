"""Captain result review links: intercepted services and no production writes."""
import copy
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from stats_view_browser import BASE, data, S, OLD, M, match, new_context, errors

LATEST = '77777777-7777-4777-8777-777777777779'
HISTORICAL = '77777777-7777-4777-8777-777777777780'
data['league'] = dict(seasonId=S, teamId='8032635', teamName='Test club', standings=[], lastSuccess='2026-11-21T20:00:00Z', state='succeeded')
latest = {**copy.deepcopy(match), 'id':LATEST, 'opponent':'Semifinal FC', 'round':3, 'kickoff':'2026-11-20T01:50:00Z', 'source':'leagueapps', 'resultSource':'captain', 'playoffRound':'semifinals', 'needsReview':True, 'leagueScore':None}
latest['result'].update(home=1,away=1,onFieldHome=1,onFieldAway=1)
historical = {**copy.deepcopy(match), 'id':HISTORICAL, 'seasonId':OLD, 'opponent':'Historical FC', 'source':'leagueapps', 'resultSource':'captain', 'needsReview':True, 'leagueScore':dict(home=2,away=1,basis='played')}
historical['result'].update(home=2,away=0,onFieldHome=2,onFieldAway=0)
data['matches'] += [latest,historical]
forfeit = data['matches'][1]
forfeit.update(source='leagueapps',resultSource='captain',needsReview=True,leagueScore=dict(home=3,away=1,basis='played'))

def review(panel, opponent):
    panel.locator('.league-message').filter(has_text=opponent).get_by_role('link',name='Review result',exact=True).click()

def selected(page,mid,home,away,check_url=True):
    expect(page.get_by_role('combobox',name='Choose a match',exact=True)).to_have_value(mid)
    expect(page.get_by_role('spinbutton',name='Mauve FC official score',exact=True)).to_have_value(str(home))
    expect(page.get_by_role('spinbutton',name='Opponent official score',exact=True)).to_have_value(str(away))
    if check_url: assert page.evaluate('new URLSearchParams(location.search).get("match")')==mid

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width in [1440,390]:
        context,page,_,_=new_context(browser,'captain',width)
        writes=[]
        page.on('request',lambda request: writes.append(request.url) if '/rpc/save_' in request.url else None)
        page.goto(BASE+'/captain/',wait_until='networkidle')
        selected(page,M,5,2,check_url=False)
        panel=page.get_by_role('region',name='LeagueApps connection')
        message=panel.locator('.league-message').filter(has_text='Semifinal FC')
        expect(message).to_contain_text('LeagueApps has no final score posted for this match.')
        expect(panel).not_to_contain_text('withdrawn')
        expect(message).to_contain_text('Your captain result and player stats are preserved.')
        expect(panel.locator('.league-message').filter(has_text='Forfeit FC')).to_contain_text('League score 3–1.')
        # Same route: changing only the query must select the requested result.
        review(panel,'Semifinal FC');selected(page,LATEST,1,1)
        expect(page.locator('.captain-page > .help-text')).to_contain_text('no final score')
        expect(page.locator('#result-editor')).to_be_in_viewport()
        # Choosing another match then using the same review link must work again.
        page.get_by_role('combobox',name='Choose a match',exact=True).select_option(M)
        selected(page,M,5,2)
        review(panel,'Semifinal FC');selected(page,LATEST,1,1)
        review(panel,'Forfeit FC');selected(page,forfeit['id'],3,0)
        # A review in another season selects that season and the exact game.
        review(panel,'Historical FC');selected(page,HISTORICAL,2,0)
        expect(page.get_by_role('combobox',name='Season',exact=True)).to_have_value(OLD)
        page.go_back(wait_until='networkidle');selected(page,forfeit['id'],3,0)
        expect(page.get_by_role('combobox',name='Season',exact=True)).to_have_value(S)
        # Manual season changes must remain usable after following review links.
        page.get_by_role('combobox',name='Season',exact=True).select_option(OLD)
        selected(page,HISTORICAL,2,0)
        review(panel,'Semifinal FC');selected(page,LATEST,1,1)
        expect(page.get_by_role('combobox',name='Season',exact=True)).to_have_value(S)
        # The existing unsaved-change protection on the selector remains intact.
        page.get_by_role('spinbutton',name='Mauve FC official score',exact=True).fill('9')
        page.once('dialog',lambda dialog:dialog.dismiss())
        page.get_by_role('combobox',name='Choose a match',exact=True).select_option(M)
        selected(page,LATEST,9,1)
        page.get_by_role('spinbutton',name='Mauve FC official score',exact=True).fill('1')
        assert page.evaluate('document.documentElement.scrollWidth')<=width
        page.screenshot(path=f'artifacts/league-result-review-{width}.png',full_page=True)
        # A fresh deep link still opens directly to the correct published score.
        page.once('dialog',lambda dialog:dialog.accept())
        page.reload(wait_until='networkidle')
        selected(page,LATEST,1,1)
        assert not writes,writes
        context.close()
    # Review changes do not grant players captain access.
    context,page,_,_=new_context(browser,'player',390)
    page.goto(BASE+'/captain/?match='+LATEST,wait_until='networkidle')
    expect(page.get_by_role('combobox',name='Choose a match',exact=True)).to_have_count(0)
    expect(page.get_by_role('region',name='LeagueApps connection')).to_have_count(0)
    context.close()
    assert not errors,errors
    print('PASS missing-score wording, same-route and repeat reviews, season changes, browser history, saved scores, unsaved selector protection and captain access; no production writes')
    browser.close()
