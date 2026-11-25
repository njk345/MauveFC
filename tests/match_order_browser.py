"""Result chronology across Home, Results, history and captain/team views; mocked APIs only."""
import copy
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from stats_view_browser import BASE,data,S,ids,match,new_context,errors

def game(suffix,name,kickoff,stage=None,round=1,won=False):
    value=copy.deepcopy(match);value.update(id=f'99999999-9999-4999-8999-{suffix:012}',opponent=name,kickoff=kickoff,playoffRound=stage,round=round)
    value['result'].update(home=2 if won else 0,away=1,onFieldHome=2 if won else 0,onFieldAway=1,attendance='partial',scorers='partial',assists='unrecorded',stats=[dict(playerId=ids[0],appeared=True,goals=1 if won else 0,assists=None)])
    return value

cases=[
 ('times',[game(1,'Later Final','2026-11-20T23:00:00Z','finals',1),game(2,'Earlier Semi','2026-11-20T22:00:00Z','semifinals',99,True)],['Later Final','Earlier Semi'],['Earlier Semi','Later Final']),
 ('same-time',[game(3,'Same-time Semi','2026-11-20T22:00:00Z','semifinals',99,True),game(4,'Same-time Final','2026-11-20T22:00:00Z','finals',1)],['Same-time Final','Same-time Semi'],['Same-time Semi','Same-time Final']),
 ('missing-time',[game(5,'Timed Semi','2026-11-20T22:00:00Z','semifinals',99,True),game(6,'Untimed Final',None,'finals',1)],['Untimed Final','Timed Semi'],['Timed Semi','Untimed Final']),
 ('natural-tie',[game(7,'Zebra Incoming','2026-11-20T22:00:00Z',round=1),game(8,'Alpha Incoming','2026-11-20T22:00:00Z',round=99)],['Zebra Incoming','Alpha Incoming'],['Zebra Incoming','Alpha Incoming']),
 ('natural-unknown',[game(9,'Zebra Unknown',None,round=1),game(10,'Alpha Unknown',None,round=99)],['Zebra Unknown','Alpha Unknown'],['Zebra Unknown','Alpha Unknown']),
]

def layout(page,width):assert page.evaluate('document.documentElement.scrollWidth')<=width

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for width in [1440,390,320]:
        for case,games,newest,oldest in cases:
            data['matches']=copy.deepcopy(games);data['seasons'][0].update(completed=True,completedAt='2026-11-21T20:00:00Z',finalPosition=5,revision=1)
            context,page,_,_=new_context(browser,'captain',width)
            page.goto(BASE+'/results/',wait_until='networkidle');expect(page.locator('.match-row .match-title-button')).to_have_text(newest);layout(page,width)
            if case=='same-time':page.screenshot(path=f'artifacts/match-order-results-{width}.png',full_page=True)
            page.goto(BASE+'/',wait_until='networkidle');expect(page.locator('.latest-match .latest-team.opponent')).to_contain_text(newest[0]);layout(page,width)
            if games[0].get('playoffRound'):expect(page.locator('.home-season-finish')).to_contain_text('Runners-up.')
            if case=='missing-time':page.screenshot(path=f'artifacts/match-order-home-{width}.png',full_page=True)
            page.goto(BASE+'/schedule/',wait_until='networkidle');page.get_by_role('button',name='All matches (2)',exact=True).click();expect(page.locator('.match-row .match-title-button')).to_have_text(oldest);layout(page,width)
            page.goto(BASE+'/players/profile/?id='+ids[0],wait_until='networkidle');rows=page.locator('.appearance-row');expect(rows).to_have_count(2);expect(rows.nth(0)).to_contain_text(newest[0]);expect(rows.nth(1)).to_contain_text(newest[1]);layout(page,width)
            if case=='same-time':
                page.goto(BASE+'/captain/stats/',wait_until='networkidle');selector=page.get_by_role('combobox',name='Choose a game',exact=True);expect(selector.locator('option').first).to_contain_text(newest[0]);expect(selector).to_have_value(games[1]['id']);layout(page,width)
                page.goto(BASE+'/team/',wait_until='networkidle');page.get_by_role('button',name='Team & lineups',exact=True).click() if page.get_by_role('button',name='Team & lineups',exact=True).count() else None
                selector=page.get_by_role('combobox',name='Match',exact=True);expect(selector).to_have_value(games[1]['id']);layout(page,width)
            context.close()
    assert not errors,errors
    print('PASS time/playoff/natural ordering across Results, Home latest result, completed season status, Schedule, profile history and captain/team selectors at 320/390/1440px; no production writes')
    browser.close()
