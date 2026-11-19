"""Native image-saving interactions are mocked; no files/messages go to OS apps.
Also runs the existing synthetic auth/lineup/image regression contract.
"""
import os,runpy
from playwright.sync_api import sync_playwright,expect
ns=runpy.run_path('tests/lineup_sheet_browser.py',run_name='__main__')
g=ns['g'];BASE=os.getenv('MAUVE_BASE_URL','http://127.0.0.1:3000')
MOBILE='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context,page,_=g['new_context'](browser,'player',390)
 context.add_init_script('Object.defineProperty(navigator,"userAgent",{get:()=>'+repr(MOBILE)+'});'+'''
 window.shareCalls=[];window.shareMode='ok';window.urls=[];window.revoked=[];
 const makeURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=function(file){const url=makeURL(file);window.urls.push(url);return url};
 URL.revokeObjectURL=function(url){window.revoked.push(url);return revokeURL(url)};
 Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
 Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{
   const call={active:navigator.userActivation.isActive,keys:Object.keys(data),name:data.files[0].name,type:data.files[0].type};window.shareCalls.push(call);
   if(window.shareMode==='abort')throw new DOMException('Cancelled','AbortError');
   if(window.shareMode==='fail')throw new DOMException('Blocked','NotAllowedError');
   const bytes=await data.files[0].arrayBuffer();call.hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].join(',');
 }});
 Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:()=>{throw new Error('Mobile must use image share first')}});
 ''')
 downloads=[];page.on('download',lambda item:downloads.append(item))
 page.goto(BASE+'/team/',wait_until='networkidle')
 save=page.get_by_role('button',name='Save image',exact=True)
 expect(save).to_be_enabled()
 assert page.evaluate('window.shareCalls.length')==0
 save.click();page.wait_for_function('window.shareCalls.length===1 && window.shareCalls[0].hash')
 expect(page.get_by_role('dialog')).to_have_count(0)
 first=page.evaluate('window.shareCalls[0]');assert first['active'] and first['keys']==['files'] and first['type']=='image/png'
 assert not downloads
 page.get_by_role('checkbox',name='First names only on team sheet').uncheck()
 page.get_by_role('button',name='Save image',exact=True).click();page.wait_for_function('window.shareCalls.length===2 && window.shareCalls[1].hash')
 assert page.evaluate('window.shareCalls[1].active')
 assert page.evaluate('window.shareCalls[1].hash')!=first['hash']
 assert page.evaluate('window.revoked.length')>=1
 page.evaluate("window.shareMode='abort'")
 save.click();page.wait_for_function('window.shareCalls.length===3')
 expect(page.get_by_role('dialog')).to_have_count(0)
 expect(page.locator('.auth-error')).to_have_count(0)
 page.evaluate("window.shareMode='fail'")
 save.click();expect(page.get_by_role('dialog')).to_be_visible()
 expect(page.get_by_role('dialog')).to_contain_text('Save Image')
 expect(page.get_by_role('dialog').get_by_role('alert')).to_contain_text('couldn’t open the image menu')
 expect(page.locator('.lineup-export-image')).to_be_visible()
 assert not downloads
 assert page.evaluate('document.documentElement.scrollWidth')<=390
 page.screenshot(path='artifacts/save-photo-ios-390.png',full_page=True)
 page.get_by_role('button',name='Close image export',exact=True).click()
 page.get_by_role('button',name='Sign out',exact=True).click()
 expect(page.get_by_role('link',name='Team sign-in',exact=True)).to_be_visible()
 page.wait_for_function('window.urls.every(url=>window.revoked.includes(url))')
 assert page.evaluate('caches.keys()')==[]
 context.close()
 print('PASS one-click mobile image menu, active user gesture, current PNG after edits, quiet cancel, failure preview and private URL cleanup',flush=True)

 context,page,_=g['new_context'](browser,'player',1440)
 context.add_init_script('''
 window.pickerCalls=[];window.pickerMode='ok';window.writeClosed=0;window.aborted=0;window.nativeShares=0;
 Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
 Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{window.nativeShares++}});
 Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:async options=>{
   window.pickerCalls.push({options,active:navigator.userActivation.isActive});
   if(window.pickerMode==='abort')throw new DOMException('Cancelled','AbortError');
   if(window.pickerMode==='fail')throw new DOMException('Blocked','SecurityError');
   return {createWritable:async()=>({write:async blob=>{if(window.pickerMode==='write-fail')throw new Error('Write failure');window.savedType=blob.type;window.savedBytes=(await blob.arrayBuffer()).byteLength},close:async()=>{window.writeClosed++},abort:async()=>{window.aborted++}})};
 }});
 ''')
 downloads=[];page.on('download',lambda item:downloads.append(item))
 page.goto(BASE+'/team/',wait_until='networkidle')
 page.get_by_role('button',name='Save image',exact=True).click()
 expect(page.locator('.lineup-image-feedback[role="status"]')).to_contain_text('Image saved.')
 call=page.evaluate('window.pickerCalls[0]');assert call['active'] and call['options']['startIn']=='pictures'
 assert call['options']['types'][0]['accept']=={'image/png':['.png']}
 assert page.evaluate('window.savedBytes')>1000 and page.evaluate('window.writeClosed')==1
 assert page.evaluate('window.nativeShares')==0 and not downloads
 page.evaluate("window.pickerMode='abort'")
 page.get_by_role('button',name='Save image',exact=True).click()
 expect(page.get_by_role('dialog')).to_have_count(0)
 assert not downloads
 page.evaluate("window.pickerMode='write-fail'")
 page.get_by_role('button',name='Save image',exact=True).click()
 expect(page.get_by_role('dialog')).to_be_visible()
 assert page.evaluate('window.aborted')==1
 expect(page.get_by_role('dialog')).to_contain_text('right-click')
 page.screenshot(path='artifacts/save-photo-desktop-1440.png',full_page=True)
 context.close()
 print('PASS desktop Pictures save picker, PNG write/close, cancellation without download and write-failure cleanup',flush=True)

 for mobile in [True,False]:
  context,page,_=g['new_context'](browser,'player',390 if mobile else 1440)
  context.add_init_script(('Object.defineProperty(navigator,"userAgent",{get:()=>'+repr(MOBILE)+'});' if mobile else '')+'''
  Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false});
  Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
  Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});
  ''')
  downloads=[];page.on('download',lambda item:downloads.append(item))
  page.goto(BASE+'/team/',wait_until='networkidle')
  page.get_by_role('button',name='Save image',exact=True).click()
  expect(page.get_by_role('dialog')).to_be_visible()
  expect(page.get_by_role('dialog')).to_contain_text('Touch and hold' if mobile else 'right-click')
  expect(page.get_by_role('dialog').get_by_role('button',name='Save image',exact=True)).to_have_count(0)
  expect(page.locator('.lineup-export-image')).to_be_visible()
  assert not downloads
  context.close()
 browser.close()
 assert not g['errors'],g['errors']
 print('PASS unsupported-browser image preview with manual photo/save-as instructions and no forced download',flush=True)
