"""Playoff editing, result presentation and championship celebrations; synthetic services only."""
import copy, json, os
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from stats_view_browser import new_context, data, S, OLD, API, BASE, card, errors

Q='77777777-7777-4777-8777-777777777783'
F='77777777-7777-4777-8777-777777777784'
NEXT='77777777-7777-4777-8777-777777777785'
def fixture(mid,opponent,round_,phase,home,away,date,status='completed'):
    m=copy.deepcopy(data['matches'][0]);m.update(id=mid,opponent=opponent,round=round_,playoffRound=phase,kickoff=date,revision=0,status=status,source='leagueapps',fixtureOverride=False)
    m['result'].update(home=home,away=away,onFieldHome=home,onFieldAway=away,stats=[],attendance='unrecorded',scorers='unrecorded',assists='unrecorded')
    if status!='completed':m.pop('result')
    return m
data['matches'] += [fixture(Q,'Queens Park Rangers of Brooklyn',3,'quarterfinals',2,1,'2026-11-10T20:00:00Z'),fixture(F,'The Long Named Finals FC',4,None,4,1,'2026-11-15T20:00:00Z'),fixture(NEXT,'Future Playoff FC',5,'semifinals',0,0,'2099-01-01T20:00:00Z','scheduled')]
final=next(m for m in data['matches'] if m['id']==F)
writes=[]
def context_for(browser,kind='captain',width=1440):
    context,page,state,respond=new_context(browser,kind,width)
    def save_fixture(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        assert kind=='captain'
        payload=route.request.post_data_json['p_fixture'];m=next(m for m in data['matches'] if m['id']==payload['id'])
        assert payload['revision']==m['revision']
        for key in ['opponent','opponentCode','color','venue','round','home','status']:
            assert payload[key]==m[key],key
        assert datetime.fromisoformat(payload['kickoff'].replace('Z','+00:00'))==datetime.fromisoformat(m['kickoff'].replace('Z','+00:00'))
        m['playoffRound']=payload.get('playoffRound',m.get('playoffRound'));m['revision']+=1;writes.append(copy.deepcopy(payload));respond(route,m['id'])
    def save_result(route):
        if route.request.method=='OPTIONS':respond(route,None);return
        body=route.request.post_data_json;m=next(m for m in data['matches'] if m['id']==body['p_match_id']);assert body['p_expected_revision']==m['revision'];assert kind=='captain';m['result']=copy.deepcopy(body['p_payload']);m['revision']+=1;respond(route,None)
    context.route(API+'/rest/v1/rpc/save_fixture',save_fixture)
    context.route(API+'/rest/v1/rpc/save_match_result',save_result)
    return context,page
def edit_phase(page,phase):
    page.goto(BASE+'/captain/fixtures/',wait_until='networkidle')
    page.locator('.management-list button').filter(has_text='The Long Named Finals FC').click()
    if phase:
        page.get_by_role('checkbox',name='Playoff match',exact=True).check()
        page.get_by_role('combobox',name='Playoff round',exact=True).select_option(phase)
    else:page.get_by_role('checkbox',name='Playoff match',exact=True).uncheck()
    page.get_by_role('button',name='Save fixture',exact=True).click()
    expect(page.get_by_role('heading',name='Edit fixture',exact=True)).to_have_count(0)
def home_record(page):
    record=page.get_by_label('Current club record')
    expect(record.locator('strong').nth(0)).to_have_text('6')
    expect(record.locator('strong').nth(1)).to_have_text('2')
    expect(record.locator('strong').nth(4)).to_have_text('+6')
def check_layout(page,width):
    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert page.evaluate('document.documentElement.scrollWidth')<=width
    for row in page.locator('.match-row').all():
        info=row.locator('.match-information').bounding_box();end=row.locator('.match-row-end').bounding_box()
        assert info['x']+info['width']<=end['x']+1,(width,info,end)

Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context,page=context_for(browser)
    for phase in ['quarterfinals','semifinals']:
        edit_phase(page,phase);assert final['playoffRound']==phase and not final['fixtureOverride']
        page.goto(BASE+'/',wait_until='networkidle');home_record(page);expect(page.locator('.home-champions')).to_have_count(0)
    edit_phase(page,'finals');assert len(writes)==3
    for kind in ['captain','player',None]:
        if kind!='captain':context.close();context,page=context_for(browser,kind)
        for width in [1440,390,320]:
            page.set_viewport_size(dict(width=width,height=1000))
            page.goto(BASE+'/',wait_until='networkidle');home_record(page)
            expect(page.locator('.home-champions')).to_contain_text('LEAGUE CHAMPIONS')
            expect(page.locator('.home-champions')).to_contain_text('4–1')
            expect(page.locator('.championship-confetti').first).to_be_attached()
            expect(page.locator('.home-standings .form-group .form-badge')).to_have_count(2)
            check_layout(page,width);page.screenshot(path=f'artifacts/playoff-home-{kind or "public"}-{width}.png',full_page=True)
            page.goto(BASE+'/schedule/',wait_until='networkidle')
            expect(page.locator('.match-row .playoff-badge')).to_contain_text('Semifinals')
            page.get_by_role('button',name='All matches (5)',exact=True).click()
            expect(page.locator('.match-row .playoff-badge')).to_have_count(3)
            check_layout(page,width)
            page.goto(BASE+'/results/',wait_until='networkidle')
            winner=page.locator('.match-row.championship-result');expect(winner).to_contain_text('Champions!');expect(winner).to_contain_text('Playoffs · Finals')
            check_layout(page,width);page.screenshot(path=f'artifacts/playoff-results-{kind or "public"}-{width}.png',full_page=True)
            winner.get_by_role('button',name='The Long Named Finals FC',exact=True).click()
            expect(page.get_by_role('dialog')).to_contain_text('Playoffs · Finals');expect(page.get_by_role('dialog')).to_contain_text('Champions!');page.get_by_role('button',name='Close match details').click()
            page.goto(BASE+'/stats/',wait_until='networkidle')
            expect(card(page,'MATCHES PLAYED')).to_have_text('4');expect(card(page,'GOALS SCORED')).to_have_text('14');expect(card(page,'ASSISTS RECORDED')).to_have_text('5')
            expect(page.locator('.coverage-panel')).to_contain_text('Playoff matches are included')
    context.close()
    context,page=context_for(browser,'captain',390)
    # A real captain result correction from win to loss removes celebrations,
    # while Home's league record remains the same.
    page.goto(BASE+'/captain/?match='+F,wait_until='networkidle')
    page.get_by_role('spinbutton',name='Mauve FC official score').fill('0')
    page.get_by_role('spinbutton',name='Opponent official score').fill('1')
    page.get_by_role('button',name='Add player details',exact=True).click();page.get_by_role('button',name='Preview result',exact=True).click();page.get_by_role('button',name='Publish result',exact=True).click()
    expect(page.get_by_role('heading',name='Another chapter, published.')).to_be_visible()
    page.goto(BASE+'/',wait_until='networkidle');home_record(page);expect(page.locator('.home-champions')).to_have_count(0);expect(page.locator('.finals-victory')).to_have_count(0)
    for home,away in [(1,1),(4,1)]:
        final['result'].update(home=home,away=away,onFieldHome=home,onFieldAway=away)
        page.reload(wait_until='networkidle');expect(page.locator('.home-champions')).to_have_count(1 if home>away else 0)
    edit_phase(page,None)
    page.goto(BASE+'/',wait_until='networkidle');expect(page.locator('.home-champions')).to_have_count(0);expect(page.get_by_label('Current club record').locator('strong').first).to_have_text('9')
    edit_phase(page,'finals')
    page.emulate_media(reduced_motion='reduce')
    page.goto(BASE+'/',wait_until='networkidle');expect(page.locator('.home-champions')).to_be_visible();expect(page.locator('.championship-confetti')).to_have_count(0)
    page.goto(BASE+'/results/',wait_until='networkidle');expect(page.locator('.finals-victory')).to_be_visible();expect(page.locator('.championship-confetti')).to_have_count(0)
    # Drafts/cancellations and a different selected season cannot crown a team.
    final['result']['published']=False;page.goto(BASE+'/',wait_until='networkidle');expect(page.locator('.home-champions')).to_have_count(0)
    final['result']['published']=True;final['status']='cancelled';page.reload(wait_until='networkidle');expect(page.locator('.home-champions')).to_have_count(0)
    final['status']='completed';page.reload(wait_until='networkidle');page.get_by_role('combobox',name='Season',exact=True).select_option(OLD);expect(page.locator('.home-champions')).to_have_count(0)
    context.close();assert not errors,errors
    print('PASS playoff captain controls, all round badges, regular Home record, inclusive Stats, trophy/confetti, corrections, privacy, reduced motion and mobile layouts')
    browser.close()
