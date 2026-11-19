"""Isolated browser contract tests. All Auth/database/Edge requests are intercepted.
Synthetic roster and future fixtures never reach production; no emails are sent.
"""
import base64,copy,json,os,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
BASE=os.getenv('MAUVE_BASE_URL','http://127.0.0.1:3000')
settings=dict(line.split('=',1) for line in Path('.env.production.local').read_text().splitlines() if '=' in line and not line.startswith('#'))
API=settings['NEXT_PUBLIC_SUPABASE_URL'];CLUB=settings['NEXT_PUBLIC_MAUVE_CLUB_ID'];S='66666666-6666-4666-8666-666666666666';M='77777777-7777-4777-8777-777777777777'
ids=[f'00000000-0000-4000-8000-{i+1:012}' for i in range(8)]
players=[{'id':pid,'name':f'Private Member {i}','number':i+1,'position':'Midfielder','initials':'PM','hometown':'Brooklyn','bio':'Team-only biography','isPublic':False} for i,pid in enumerate(ids)]
public={'players':[],'seasons':[{'id':S,'name':'Test season','competition':'Test league','format':'7v7'}],'roster':[],'matches':[{'id':M,'seasonId':S,'opponent':'Future FC','opponentCode':'FFC','color':'#657293','kickoff':'2099-01-01T20:00:00Z','venue':'Test pitch','round':1,'home':True,'status':'scheduled','revision':0}]}
team={**copy.deepcopy(public),'players':players,'roster':[{'seasonId':S,'playerId':pid} for pid in ids],'rsvps':[]}
published={'formation':'2-3-1','starters':ids[:7],'bench':[ids[7]]};draft=None;revision=1;accounts=[{'playerId':pid,'status':'unlinked','email':None,'role':None,'expiresAt':None} for pid in ids]
posts=[{'id':'official-initial','matchId':M,'kind':'official','payload':copy.deepcopy(published),'authorName':'Test Captain','createdAt':'2026-11-13T12:00:00Z','canDelete':False}]
counts={'verify':0,'password':0,'rsvp':0,'invite':0};errors=[]
def identity(kind):
 return {'id':'33333333-3333-4333-8333-333333333333' if kind=='captain' else '44444444-4444-4444-8444-444444444444','aud':'authenticated','role':'authenticated','email':kind+'@example.com','app_metadata':{},'user_metadata':{},'created_at':'2026-11-09T00:00:00Z'}
def session(kind):
 encode=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
 user=identity(kind);jwt=encode({'alg':'HS256','typ':'JWT'})+'.'+encode({'sub':user['id'],'exp':int(time.time())+3600,'aud':'authenticated','role':'authenticated'})+'.contract-only'
 return {'access_token':jwt,'refresh_token':'contract-only','expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':user}
def snapshot(kind):
 data=copy.deepcopy(team);payload=draft if kind=='captain' and draft is not None else published
 data['lineups']=[] if payload is None else [{'matchId':M,'payload':copy.deepcopy(payload),'shared':published is not None,'updatedAt':'2026-11-13T12:00:00Z',**({'revision':revision,'hasDraft':draft is not None} if kind=='captain' else {})}]
 return data
def new_context(browser,kind=None,width=390):
 state={'kind':kind,'profile':ids[0] if kind=='captain' else ids[1]}
 context=browser.new_context(viewport={'width':width,'height':1000})
 if kind:context.add_init_script('localStorage.setItem("mauve-fc-auth",'+json.dumps(json.dumps(session(kind)))+')')
 def stub(route):
  global published,draft,revision
  req=route.request;path=req.url.split(API)[-1];body=req.post_data_json if req.post_data else {};payload={};status=200
  if req.method=='OPTIONS':pass
  elif path.startswith('/auth/v1/verify'):
   assert body.get('token_hash')=='private-contract-token';counts['verify']+=1;state['kind']='player';payload=session('player')
  elif path.startswith('/auth/v1/token'):
   if body.get('password')!='a-good-test-password':status=400;payload={'message':'Invalid credentials'}
   else:state['kind']='player';payload=session('player')
  elif path.startswith('/auth/v1/user'):
   if req.method=='PUT':assert body['password']=='a-good-test-password';counts['password']+=1
   payload=identity(state['kind']) if state['kind'] else {'message':'No session'};status=200 if state['kind'] else 401
  elif path.startswith('/auth/v1/logout'):state['kind']=None
  elif path.endswith('/get_team_access'):payload={'member':bool(state['kind']),'role':state['kind'],'playerId':state['profile'] if state['kind'] else None}
  elif path.endswith('/get_public_club'):payload=public
  elif path.endswith('/get_captain_club'):payload=snapshot('captain') if state['kind']=='captain' else {};status=200 if state['kind']=='captain' else 403
  elif path.startswith('/rest/v1/match_drafts'):payload=[]
  elif path.endswith('/get_team_club'):payload=snapshot(state['kind']) if state['kind'] else {};status=200 if state['kind'] else 403
  elif path.endswith('/save_match_rsvp'):
   assert state['kind'] and set(body)=={'p_match_id','p_response'};counts['rsvp']+=1
   team['rsvps']=[r for r in team['rsvps'] if r['playerId']!=state['profile']]
   if body['p_response'] is not None:team['rsvps'].append({'matchId':M,'playerId':state['profile'],'response':body['p_response'],'updatedAt':'2026-11-13T12:00:00Z','needsConfirmation':False})
   payload=None
  elif path.endswith('/get_lineup_posts'):
   payload=[{**copy.deepcopy(post),'canDelete':post['kind']=='suggestion' and (state['kind']=='captain' or post.get('owner')==state['kind'])} for post in posts] if state['kind'] else {};status=200 if state['kind'] else 403
  elif path.endswith('/post_lineup_suggestion'):
   assert state['kind'];assert len(set(body['p_payload']['starters']))==7
   pid='suggestion-'+str(len(posts));posts.insert(0,{'id':pid,'matchId':M,'kind':'suggestion','payload':copy.deepcopy(body['p_payload']),'authorName':'Private Member 1','createdAt':'2026-11-15T22:00:00Z','owner':state['kind']});payload=pid
  elif path.endswith('/delete_lineup_suggestion'):
   post=next(post for post in posts if post['id']==body['p_post_id']);assert post['kind']=='suggestion' and (state['kind']=='captain' or post['owner']==state['kind']);posts.remove(post);payload=None
  elif path.endswith('/save_match_lineup'):
   assert state['kind']=='captain'
   if body['p_expected_revision']!=revision:status=409;payload={'code':'40001','message':'Lineup changed'}
   else:
    revision+=1
    if body['p_publish']:
     published=copy.deepcopy(body['p_payload']);draft=None
     posts.insert(0,{'id':'official-'+str(revision),'matchId':M,'kind':'official','payload':copy.deepcopy(published),'authorName':'Test Captain','createdAt':'2026-11-15T21:00:00Z','canDelete':False})
    else:draft=copy.deepcopy(body['p_payload'])
    payload=None
  elif path.endswith('/unshare_match_lineup'):draft=draft or published;published=None;revision+=1;posts[:]=[post for post in posts if post['kind']!='official'];payload=None
  elif path.endswith('/get_player_accounts'):assert state['kind']=='captain';payload=accounts
  elif path.endswith('/link_captain_profile'):state['profile']=body['p_player_id'];payload=None
  elif path.endswith('/revoke_player_access'):
   account=next(a for a in accounts if a['playerId']==body['p_player_id']);account.update(status='unlinked',email=None);payload=None
  elif path=='/functions/v1/player-invite':
   assert state['kind']=='captain';counts['invite']+=1
   account=next(a for a in accounts if a['playerId']==body['playerId']);account.update(status='invited',email=body['email']);payload={'link':BASE+'/login/#token_hash=private-contract-token&type=invite'}
  else:status=403;payload={'message':'No real calls allowed'}
  route.fulfill(status=status,content_type='application/json',headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body=json.dumps(payload))
 context.route(API+'/**',stub)
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 return context,page,state
Path('artifacts').mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context,page,state=new_context(browser)
 page.goto(BASE+'/team/',wait_until='networkidle');expect(page.get_by_role('link',name='Team sign-in',exact=True)).to_be_visible();assert 'Private Member' not in page.locator('main').inner_text()
 page.goto(BASE+'/login/#token_hash=private-contract-token&type=invite',wait_until='networkidle');expect(page.get_by_role('button',name='Accept invitation',exact=True)).to_be_visible();assert counts['verify']==0
 page.get_by_role('button',name='Accept invitation',exact=True).click();expect(page.get_by_label('New password',exact=True)).to_be_visible(timeout=15000)
 assert '#' not in page.url
 page.get_by_label('New password',exact=True).fill('a-good-test-password');page.get_by_label('Confirm password',exact=True).fill('wrong-but-long-password');page.get_by_role('button',name='Save password & open team').click();expect(page.locator('.auth-error[role="alert"]')).to_contain_text('do not match')
 page.get_by_label('Confirm password',exact=True).fill('a-good-test-password');page.get_by_role('button',name='Save password & open team').click();expect(page.get_by_role('heading',name='Our club. Our corner.')).to_be_visible(timeout=15000)
 assert counts['password']==1
 page.get_by_role('button',name='In',exact=True).click();expect(page.get_by_role('button',name='In',exact=True)).to_have_attribute('aria-pressed','true')
 page.get_by_role('button',name='Maybe',exact=True).click();expect(page.get_by_role('button',name='Maybe',exact=True)).to_have_attribute('aria-pressed','true')
 team['matches'][0]['kickoff']='2099-01-08T20:00:00Z';team['rsvps'][0]['needsConfirmation']=True
 page.get_by_role('button',name='Refresh team',exact=True).click();expect(page.get_by_text('Kickoff changed. Please confirm your reply.')).to_be_visible()
 page.get_by_role('button',name='In',exact=True).click();expect(page.get_by_role('button',name='In',exact=True)).to_have_attribute('aria-pressed','true')
 expect(page.get_by_role('button',name='Share lineup',exact=True)).to_have_count(0)
 page.get_by_role('button',name='Private roster (8)',exact=True).click();expect(page.locator('.team-player-card')).to_have_count(8);expect(page.locator('.team-player-card').nth(1)).to_contain_text('YOU')
 assert page.evaluate('document.documentElement.scrollWidth')<=390
 page.screenshot(path='artifacts/team-roster-player-390.png',full_page=True)
 page.goto(BASE+'/players/',wait_until='networkidle');assert 'Private Member' not in page.locator('main').inner_text()
 page.goto(BASE+'/team/',wait_until='networkidle');page.get_by_role('button',name='Sign out',exact=True).click();expect(page.get_by_role('link',name='Team sign-in',exact=True)).to_be_visible();assert 'Private Member' not in page.locator('main').inner_text()
 print('PASS explicit invite acceptance, password setup, player privacy, own RSVP, reschedule confirmation and sign-out',flush=True);context.close()
 context,page,state=new_context(browser,'captain')
 page.goto(BASE+'/team/',wait_until='networkidle');page.get_by_role('button',name='Create a lineup from this',exact=True).click();page.get_by_role('combobox',name='Formation',exact=True).select_option('3-2-1');page.get_by_role('button',name='Save lineup draft',exact=True).click();expect(page.get_by_text('PRIVATE DRAFT',exact=True)).to_be_visible()
 assert published['formation']=='2-3-1' and draft['formation']=='3-2-1'
 page.get_by_role('button',name='Preview image',exact=True).click();expect(page.get_by_role('dialog')).to_be_visible()
 expect(page.locator('.lineup-export-image')).to_have_attribute('alt','Captain draft: 3-2-1 formation for Mauve FC versus Future FC')
 page.get_by_role('button',name='Close image export',exact=True).click()
 page.get_by_role('button',name='Publish official lineup',exact=True).click();expect(page.get_by_text('OFFICIAL',exact=True)).to_be_visible();assert published['formation']=='3-2-1' and draft is None
 assert page.evaluate('document.documentElement.scrollWidth')<=390
 page.screenshot(path='artifacts/team-captain-390.png',full_page=True)
 page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='artifacts/team-captain-1440.png',full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth')<=1440
 page.goto(BASE+'/captain/access/',wait_until='networkidle');page.get_by_role('combobox',name='Player',exact=True).select_option(ids[1]);page.get_by_role('textbox',name='Player email',exact=True).fill('player@example.com');page.get_by_role('button',name='Create private invite',exact=True).click();expect(page.get_by_role('textbox',name='Private invitation link')).to_have_value(BASE+'/login/#token_hash=private-contract-token&type=invite');assert counts['invite']==1
 page.on('dialog',lambda dialog:dialog.accept());page.locator('.account-list article').nth(1).get_by_role('button',name='Revoke access').click();expect(page.locator('.account-list article').nth(1)).to_contain_text('Not invited')
 page.get_by_role('combobox',name='Your roster profile',exact=True).select_option(ids[0]);page.get_by_role('button',name='Link my profile',exact=True).click()
 print('PASS captain lineup drafts/sharing, responsive pitch, private invitation UI and access revocation',flush=True);context.close()
 context,page,state=new_context(browser,'player');page.goto(BASE+'/login/',wait_until='networkidle');page.evaluate('localStorage.clear()');context.close()
 context,page,state=new_context(browser);page.goto(BASE+'/login/',wait_until='networkidle');page.get_by_role('textbox',name='Invited email').fill('player@example.com');page.get_by_label('Password',exact=True).fill('wrong-password');page.get_by_role('button',name='Sign in',exact=True).click();expect(page.locator('.auth-error[role="alert"]')).to_contain_text('could not be verified');page.get_by_label('Password',exact=True).fill('a-good-test-password');page.get_by_role('button',name='Sign in',exact=True).click();expect(page.get_by_role('heading',name='Our club. Our corner.')).to_be_visible();expect(page.get_by_role('heading',name='The captain’s match plan.')).to_be_visible()
 expect(page.get_by_role('combobox',name='Official lineups',exact=True)).to_have_value('official-3')
 expect(page.get_by_role('button',name='Save lineup draft',exact=True)).to_have_count(0)
 page.get_by_role('button',name='Create a lineup from this',exact=True).click()
 page.get_by_role('combobox',name='Formation',exact=True).select_option('2-2-2')
 expect(page.get_by_role('button',name='Save lineup draft',exact=True)).to_have_count(0)
 expect(page.get_by_role('button',name='Publish official lineup',exact=True)).to_have_count(0)
 page.get_by_role('button',name='Post suggestion',exact=True).click()
 expect(page.get_by_text('SUGGESTION',exact=True)).to_be_visible()
 assert published['formation']=='3-2-1'
 expect(page.get_by_role('combobox',name='Team suggestions',exact=True)).not_to_have_value('')
 page.evaluate('Object.defineProperty(navigator,"canShare",{configurable:true,value:()=>true});Object.defineProperty(navigator,"share",{configurable:true,value:async data=>{window.sharedImageName=data.files[0].name}})')
 page.get_by_role('button',name='Preview image',exact=True).click()
 expect(page.get_by_role('dialog')).to_be_visible()
 page.get_by_role('button',name='Share image',exact=True).click();assert page.evaluate('window.sharedImageName').endswith('.png')
 with page.expect_download() as info:page.get_by_role('link',name='Download PNG',exact=True).click()
 download=info.value;download.save_as('artifacts/lineup-export-member.png')
 import struct
 raw=Path('artifacts/lineup-export-member.png').read_bytes();assert raw[:8]==b'\x89PNG\r\n\x1a\n';assert struct.unpack('>II',raw[16:24])==(1200,1720)
 page.get_by_role('button',name='Close image export',exact=True).click()
 assert page.evaluate('document.documentElement.scrollWidth')<=390
 page.screenshot(path='artifacts/lineup-suggestions-390.png',full_page=True)
 page.get_by_role('combobox',name='Official lineups',exact=True).select_option('official-initial')
 expect(page.locator('.formation-pitch')).to_have_attribute('aria-label','2-3-1 formation')
 page.reload(wait_until='networkidle')
 expect(page.get_by_role('combobox',name='Official lineups',exact=True)).to_have_value('official-3')
 page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='artifacts/lineup-selectors-1440.png',full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth')<=1440
 page.get_by_role('button',name='Create a lineup from this',exact=True).click()
 page.get_by_role('combobox',name='Starter GK',exact=True).select_option('')
 expect(page.get_by_role('button',name='Post suggestion',exact=True)).to_be_disabled()
 page.get_by_role('button',name='Preview image',exact=True).click();expect(page.get_by_role('dialog')).to_be_visible()
 page.get_by_role('button',name='Close image export',exact=True).click()
 assert not errors,errors
 print('PASS member creation/posts, separate selectors, latest official default, draft restrictions, incomplete and complete PNG export',flush=True)
 print('PASS returning player password sign-in and shared formation; no browser errors',flush=True);browser.close()
