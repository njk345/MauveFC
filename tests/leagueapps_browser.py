"""Real anonymous reads plus an isolated captain UI contract test.
The captain identity and mutations are intercepted in-browser; no real writes or
sign-in emails occur. urllib preserves the managed cloud proxy's CA verification.
"""
import base64, copy, json, os, time, urllib.request, urllib.error, ssl
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE=os.getenv('MAUVE_BASE_URL','http://127.0.0.1:3000')
settings=dict(line.split('=',1) for line in Path('.env.production.local').read_text().splitlines() if '=' in line and not line.startswith('#'))
API=settings['NEXT_PUBLIC_SUPABASE_URL'];KEY=settings['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];CLUB=settings['NEXT_PUBLIC_MAUVE_CLUB_ID']
req=urllib.request.Request(API+'/rest/v1/rpc/get_public_club',data=json.dumps({'p_club_id':CLUB}).encode(),headers={'apikey':KEY,'Content-Type':'application/json'})
with urllib.request.urlopen(req,context=ssl.create_default_context()) as response:snapshot=json.load(response)
def bridge(route):
 req=route.request
 request=urllib.request.Request(req.url,headers={**req.headers,'accept-encoding':'identity'},data=req.post_data_buffer,method=req.method)
 try:response=urllib.request.urlopen(request,timeout=25,context=ssl.create_default_context())
 except urllib.error.HTTPError as error:response=error
 headers={k:v for k,v in response.headers.items() if k.lower() not in ['content-encoding','content-length','transfer-encoding']}
 route.fulfill(status=response.status,headers=headers,body=response.read())
Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page();page.route(API+'/**',bridge);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 for width in [390,1440]:
  page.set_viewport_size({'width':width,'height':1000})
  page.goto(BASE+'/',wait_until='networkidle')
  expect(page.locator('.home-standings-table tbody tr')).to_have_count(9)
  expect(page.locator('.mauve-standing')).to_contain_text('It’s Coming Home (Lilac)')
  expect(page.locator('.mauve-standing')).to_contain_text('14')
  expect(page.locator('.fixture-card')).to_contain_text('Thottenham Hotgurls')
  expect(page.locator('.fixture-card')).to_contain_text('Nov')
  expect(page.locator('.home-season-summary')).to_contain_text('14')
  assert page.evaluate('document.documentElement.scrollWidth')<=width
  page.screenshot(path=f'artifacts/leagueapps-home-{width}.png',full_page=True)
  page.goto(BASE+'/schedule/',wait_until='networkidle')
  expect(page.locator('.match-row')).to_have_count(1)
  page.get_by_role('button',name='Awaiting results (1)').click()
  expect(page.locator('.match-row')).to_have_count(1)
  expect(page.locator('.match-row')).to_contain_text('Farcelona')
  expect(page.locator('.match-row')).to_contain_text('Awaiting league result')
  page.get_by_role('button',name='All matches (8)').click()
  expect(page.locator('.match-row')).to_have_count(8)
  page.goto(BASE+'/results/',wait_until='networkidle')
  expect(page.locator('.match-row')).to_have_count(6)
  page.get_by_role('button',name='Wins',exact=True).click();expect(page.locator('.match-row')).to_have_count(4)
  page.get_by_role('button',name='Draws',exact=True).click();expect(page.locator('.match-row')).to_have_count(2)
  print('PASS real LeagueApps standings, next match, missing-score fixture and results at',width,flush=True)
 page.close()
 # UI-only captain session. Auth and every mutation are stubbed.
 data=copy.deepcopy(snapshot);m=data['matches'][0];m['needsReview']=True;m['leagueScore']={'home':3,'away':0,'basis':'played'}
 own_id='33333333-3333-4333-8333-333333333333'
 user={'id':own_id,'aud':'authenticated','role':'authenticated','email':'captain@example.com','app_metadata':{},'user_metadata':{},'created_at':'2026-11-09T00:00:00Z'}
 encode=lambda obj:base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
 jwt=encode({'alg':'HS256','typ':'JWT'})+'.'+encode({'sub':own_id,'exp':int(time.time())+3600,'aud':'authenticated','role':'authenticated'})+'.ui-contract-only'
 session={'access_token':jwt,'refresh_token':'ui-contract-only','expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':user}
 context=b.new_context(viewport={'width':390,'height':1000});context.add_init_script('localStorage.setItem("mauve-fc-auth",'+json.dumps(json.dumps(session))+')')
 queued=False;polls=0;refresh_calls=0;restores=0
 def stub(route):
  global queued,polls,refresh_calls,restores
  path=route.request.url.split(API)[-1];payload={};status=200
  if route.request.method=='OPTIONS':pass
  elif path.startswith('/auth/v1/user'):payload=user
  elif path.startswith('/rest/v1/club_memberships'):payload=[{'role':'captain'}]
  elif path.startswith('/rest/v1/match_drafts'):payload=[]
  elif path.endswith('/get_public_club'):payload=snapshot
  elif path.endswith('/get_captain_club'):
   if queued:
    polls+=1;data['league']['state']='running' if polls<2 else 'succeeded'
   payload=data
  elif path.endswith('/request_league_sync'):refresh_calls+=1;queued=True;data['league']['state']='queued';payload=None
  elif path.endswith('/save_fixture'):
   fixture=route.request.post_data_json['p_fixture'];target=next(v for v in data['matches'] if v['id']==fixture['id']);target.update(fixture);target['fixtureOverride']=True;target['revision']+=1;payload=target['id']
  elif path.endswith('/use_league_fixture'):
   fixture=route.request.post_data_json;target=next(v for v in data['matches'] if v['id']==fixture['p_match_id']);target['venue']='Field 3';target['fixtureOverride']=False;target['revision']+=1;restores+=1;payload=None
  else:status=403;payload={'message':'No real writes allowed in UI test'}
  route.fulfill(status=status,content_type='application/json',headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body=json.dumps(payload))
 context.route(API+'/**',stub);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/captain/',wait_until='networkidle')
 panel=page.get_by_role('region',name='LeagueApps connection')
 expect(panel).to_contain_text('Your captain result and player stats are preserved.')
 panel.get_by_role('button',name='Refresh now').click()
 expect(panel.get_by_role('button',name='Refreshing…')).to_be_disabled()
 expect(panel.get_by_role('button',name='Refresh now')).to_be_enabled(timeout=15000)
 assert refresh_calls==1
 page.screenshot(path='artifacts/leagueapps-captain-390.png',full_page=True)
 page.goto(BASE+'/captain/fixtures/',wait_until='networkidle')
 page.locator('.management-list button').last.click()
 page.get_by_role('textbox',name='Venue',exact=True).fill('Captain venue')
 page.get_by_role('button',name='Save fixture',exact=True).click()
 expect(page.locator('.management-list')).to_contain_text('Captain override')
 page.locator('.management-list button').last.click()
 page.get_by_role('button',name='Restore league fixture details',exact=True).click()
 expect(page.locator('.management-list')).not_to_contain_text('Captain override')
 assert restores==1
 assert page.evaluate('document.documentElement.scrollWidth')<=390
 assert not errors,errors
 print('PASS captain refresh polling, conflict notice and override restoration (intercepted UI contract)',flush=True)
 b.close()
