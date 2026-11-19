"""Position substitutes/name-display checks with intercepted synthetic services only."""
import copy, os, runpy, struct
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ns = runpy.run_path('tests/team_browser.py',run_name='__main__')
g = ns['new_context'].__globals__
BASE = os.getenv('MAUVE_BASE_URL','http://127.0.0.1:3000')
names = ['Alexandra Beatrice Montgomery-Richardson','Avery Blake','Jamie Park','Morgan Sullivan','Christopher Edwards','Sam Rivera','Taylor Quinn','Jordan Bennett','María-José de la Cruz','Sebastian Alexander-Cunningham','Cameron Harrison','Riley Thompson','Drew Henderson','Charlie Walker','Casey Anderson']
ids = [f'00000000-0000-4000-8000-{i+1:012}' for i in range(15)]
players = [{**g['players'][0],'id':pid,'name':names[i],'number':i+1} for i,pid in enumerate(ids)]
g['players'][:]=players
g['team']['players']=g['players']
g['team']['roster']=[{'seasonId':g['S'],'playerId':pid} for pid in ids]
sheet={'formation':'2-3-1','starters':ids[:7],'bench':ids[7:],'benchPositions':{ids[7]:6,ids[8]:6,ids[9]:4,ids[10]:4,ids[11]:1,ids[12]:2,ids[13]:0},'firstNamesOnly':False}
g['published']=copy.deepcopy(sheet);g['draft']=None;g['revision']=1
g['posts'][:]=[{'id':'sheet-official','matchId':g['M'],'kind':'official','payload':copy.deepcopy(sheet),'authorName':'Captain','createdAt':'2026-11-19T16:00:00Z','canDelete':False}]

def check_geometry(page,width):
    assert page.evaluate('document.documentElement.scrollWidth')<=width
    rows=page.locator('.formation-row').evaluate_all('(rows)=>rows.map(row=>{const r=row.getBoundingClientRect();return {top:r.top,bottom:r.bottom,slots:[...row.querySelectorAll(".formation-slot")].map(s=>{const b=s.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom}})}})')
    for i,row in enumerate(rows):
        if i:assert row['top']-rows[i-1]['bottom']>=16,rows
        for j,slot in enumerate(row['slots']):
            assert slot['bottom']<=row['bottom']+1
            if j:assert slot['left']>=row['slots'][j-1]['right']+3
    assert page.locator('.formation-position-subs li').count()==7

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    context,page,_=g['new_context'](browser,'captain',1440)
    page.add_init_script('window.sheetText=[];const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...rest){window.sheetText.push(String(text));return original.call(this,text,...rest)}')
    page.goto(BASE+'/team/',wait_until='networkidle')
    expect(page.locator('[data-slot="ST"] .formation-position-subs li')).to_have_count(2)
    expect(page.locator('.sheet-bench-list li')).to_have_count(8)
    expect(page.locator('.sheet-bench-list')).to_contain_text('Casey Anderson')
    for width in [1440,390,320]:
        page.set_viewport_size({'width':width,'height':1100})
        check_geometry(page,width)
        page.locator('.formation-pitch').screenshot(path=f'artifacts/sheet-full-names-{width}.png')
        page.get_by_role('checkbox',name='First names only on team sheet').check()
        expect(page.locator('.formation-pitch')).not_to_contain_text('Montgomery-Richardson')
        expect(page.locator('.formation-pitch')).not_to_contain_text('de la Cruz')
        expect(page.locator('.formation-pitch')).to_contain_text('María-José')
        expect(page.locator('.sheet-bench-list')).not_to_contain_text('Anderson')
        page.locator('.formation-pitch').screenshot(path=f'artifacts/sheet-first-names-{width}.png')
        check_geometry(page,width)
        page.get_by_role('checkbox',name='First names only on team sheet').uncheck()
    page.get_by_role('checkbox',name='First names only on team sheet').check()
    page.get_by_role('button',name='Export image',exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    with page.expect_download() as normal:page.get_by_role('link',name='Download PNG',exact=True).click()
    normal.value.save_as('artifacts/team-sheet-export.png')
    page.get_by_role('button',name='Close image export',exact=True).click()
    page.get_by_role('checkbox',name='First names only on team sheet').uncheck()
    page.get_by_role('button',name='Create a lineup from this',exact=True).click()
    for formation in ['3-2-1','2-2-2','2-3-1']:
        page.get_by_role('combobox',name='Formation',exact=True).select_option(formation)
        # Roles that disappear return their subs to the general bench.
        if formation=='3-2-1':assert page.get_by_role('combobox',name='Substitute position for Sebastian Alexander-Cunningham',exact=True).input_value()==''
        for pid in ids[7:]:
            page.get_by_role('combobox',name='Substitute position for '+names[ids.index(pid)],exact=True).select_option('0')
        assert page.locator('[data-slot="GK"] .formation-position-subs li').count()==8
        page.get_by_role('checkbox',name='First names only on team sheet').check()
        assert page.evaluate('document.documentElement.scrollWidth')<=320
        rows=page.locator('.formation-row').evaluate_all('(rows)=>rows.map(r=>({top:r.getBoundingClientRect().top,bottom:r.getBoundingClientRect().bottom}))')
        assert all(rows[i]['top']>rows[i-1]['bottom']+16 for i in range(1,len(rows)))
    # Removing or promoting a substitute must remove any stale position mapping.
    page.get_by_role('combobox',name='Starter ST',exact=True).select_option(ids[7])
    assert page.get_by_role('combobox',name='Substitute position for '+names[7],exact=True).count()==0
    page.get_by_role('combobox',name='Starter ST',exact=True).select_option(ids[6])
    page.get_by_role('checkbox',name='#8 Jordan',exact=True).check()
    page.get_by_role('combobox',name='Substitute position for '+names[7],exact=True).select_option('0')
    page.get_by_role('button',name='Save lineup draft',exact=True).click()
    expect(page.get_by_text('PRIVATE DRAFT',exact=True)).to_be_visible()
    assert g['draft']['firstNamesOnly'] is True and len(g['draft']['benchPositions'])==8
    page.get_by_role('button',name='Publish official lineup',exact=True).click()
    expect(page.get_by_text('OFFICIAL',exact=True)).to_be_visible()
    assert g['published']['firstNamesOnly'] is True and len(g['published']['benchPositions'])==8
    page.evaluate('window.sheetText=[]')
    page.get_by_role('button',name='Export image',exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    with page.expect_download() as download:page.get_by_role('link',name='Download PNG',exact=True).click()
    download.value.save_as('artifacts/position-subs-export.png')
    data=Path('artifacts/position-subs-export.png').read_bytes();width,height=struct.unpack('>II',data[16:24]);assert width==1200 and height>1720,(width,height)
    drawn=page.evaluate('window.sheetText');assert 'María-José' in drawn
    assert not any('Montgomery-Richardson' in text or 'de la Cruz' in text for text in drawn)
    assert sum('Jordan' in text for text in drawn)>=2
    page.get_by_role('button',name='Close image export',exact=True).click()
    context.close()
    context,page,_=g['new_context'](browser,'player',390)
    page.goto(BASE+'/team/',wait_until='networkidle')
    expect(page.locator('[data-slot="GK"] .formation-position-subs li')).to_have_count(8)
    page.get_by_role('checkbox',name='First names only on team sheet').uncheck()
    expect(page.locator('.formation-pitch')).to_contain_text('Montgomery-Richardson')
    assert g['published']['firstNamesOnly'] is True
    page.get_by_role('button',name='Create a lineup from this',exact=True).click()
    page.get_by_role('checkbox',name='First names only on team sheet').check()
    page.get_by_role('button',name='Post suggestion',exact=True).click()
    expect(page.get_by_text('SUGGESTION',exact=True)).to_be_visible()
    assert g['posts'][0]['payload']['firstNamesOnly'] is True
    assert len(g['posts'][0]['payload']['benchPositions'])==8
    assert not g['errors'],g['errors']
    context.close();browser.close()
print('PASS positional/general subs, all formation layouts at 320/390/1440, first names, stale assignment cleanup, draft/official/suggestion persistence and tall PNG export',flush=True)
