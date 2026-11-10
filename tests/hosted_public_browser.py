"""Anonymous browser checks against the configured real Supabase project.
Only the cloud QA transport uses Python requests to retain the managed proxy's CA
trust. Responses are fetched from the actual service with certificate verification.
No authentication emails or writes are triggered.
"""
import os
import urllib.request
import urllib.error
import ssl
from playwright.sync_api import sync_playwright,expect
BASE=os.getenv('MAUVE_BASE_URL','http://127.0.0.1:3000')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def bridge(route):
  req=route.request
  headers={**req.headers,'accept-encoding':'identity'}
  request=urllib.request.Request(req.url,headers=headers,data=req.post_data_buffer,method=req.method)
  try: response=urllib.request.urlopen(request,timeout=25,context=ssl.create_default_context())
  except urllib.error.HTTPError as error: response=error
  headers={k:v for k,v in response.headers.items() if k.lower() not in ['content-encoding','content-length','transfer-encoding']}
  route.fulfill(status=response.status,headers=headers,body=response.read())
 page.route('https://maupvkabgveqvwkivtyh.supabase.co/**',bridge)
 for width in [390,1440]:
  page.set_viewport_size({'width':width,'height':900})
  for route in ['/','/schedule/','/results/','/players/','/stats/','/captain/','/captain/fixtures/','/captain/roster/','/login/']:
   page.goto(BASE+route,wait_until='networkidle')
   assert page.evaluate('document.documentElement.scrollWidth')<=width,(width,route)
   assert 'We couldn’t load the club.' not in page.locator('main').inner_text(),route
   if route.startswith('/captain'):
    expect(page.get_by_role('link',name='Captain sign-in',exact=True)).to_be_visible()
    expect(page.get_by_role('button',name='Save draft',exact=True)).to_have_count(0)
    expect(page.get_by_role('button',name='Add fixture',exact=True)).to_have_count(0)
    expect(page.get_by_role('button',name='Add player',exact=True)).to_have_count(0)
   if route=='/login/':expect(page.get_by_role('button',name='Send sign-in link')).to_be_visible()
  print('PASS live public routes and signed-out captain access at',width,flush=True)
 assert page.evaluate("localStorage.getItem('mauve-fc-prototype-v1')") is None
 assert not errors,errors
 print('PASS live mode has no sample storage or browser errors',flush=True)
 b.close()
