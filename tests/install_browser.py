"""Installation and privacy checks against the static build.
Service calls use the existing synthetic team contract; nothing is written to production.
Run with MAUVE_BASE_URL pointing at a locally served out/ directory.
"""
import json, os, runpy, struct, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

# Also checks that installation metadata/providers preserve team sign-in and access.
contract = runpy.run_path('tests/team_browser.py', run_name='__main__')
BASE = os.getenv('MAUVE_BASE_URL', 'http://127.0.0.1:3000')

def install_event(page, outcome='dismissed', fail=False):
    return page.evaluate('''({outcome,fail}) => {
      const event = new Event('beforeinstallprompt', {cancelable:true});
      Object.defineProperty(event, 'prompt', {value:async()=>{
        window.installPromptCalls=(window.installPromptCalls||0)+1;
        if(fail) throw new Error('Test unavailable browser prompt');
      }});
      Object.defineProperty(event, 'userChoice', {value:Promise.resolve({outcome})});
      return window.dispatchEvent(event);
    }''', {'outcome':outcome,'fail':fail})

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH','/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    # Chrome refuses installation in incognito contexts. Check eligibility in a
    # disposable regular profile, with the same intercepted synthetic services.
    profile = tempfile.TemporaryDirectory(prefix='mauve-install-check-')
    class RegularBrowser:
        def new_context(self, **options):
            return p.chromium.launch_persistent_context(profile.name, executable_path=os.getenv('CHROMIUM_PATH','/usr/bin/chromium'), headless=True, args=['--no-sandbox'], **options)
    context, page, _ = contract['new_context'](RegularBrowser(), None, 1440)
    page.goto(BASE+'/install/', wait_until='networkidle')
    manifest_link = page.locator('link[rel="manifest"]')
    expect(manifest_link).to_have_count(1)
    manifest = context.request.get(BASE+manifest_link.get_attribute('href')).json()
    assert manifest['start_url']=='/team/' and manifest['scope']=='/' and manifest['display']=='standalone'
    for icon in manifest['icons']:
        response = context.request.get(BASE+icon['src'])
        assert response.ok
        data = response.body()
        assert data[:8] == b'\x89PNG\r\n\x1a\n'
        width, height = struct.unpack('>II',data[16:24])
        assert f'{width}x{height}' == icon['sizes']
    apple = page.locator('link[rel="apple-touch-icon"]')
    expect(apple).to_have_attribute('sizes','180x180')
    assert context.request.get(BASE+apple.get_attribute('href')).ok
    expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).to_have_attribute('content','yes')
    expect(page.locator('meta[name="theme-color"]')).to_have_attribute('content','#342238')
    assert 'viewport-fit=cover' in page.locator('meta[name="viewport"]').get_attribute('content')
    cdp = context.new_cdp_session(page)
    cdp.send('Page.enable')
    app = cdp.send('Page.getAppManifest')
    assert not app['errors'],app['errors']
    errors = cdp.send('Page.getInstallabilityErrors')['installabilityErrors']
    assert not errors,errors
    print('PASS browser accepts manifest, installability and branded PNG/Apple icons',flush=True)
    page.screenshot(path='artifacts/install-desktop-1440.png',full_page=True)
    assert install_event(page) is False
    page.get_by_role('button',name='Install Mauve FC',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('No problem.')
    expect(page.get_by_role('button',name='Install Mauve FC',exact=True)).to_have_count(0)
    assert page.evaluate('window.installPromptCalls')==1
    install_event(page,fail=True)
    page.get_by_role('button',name='Install Mauve FC',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Use the browser steps')
    install_event(page,'accepted')
    page.get_by_role('button',name='Install Mauve FC',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Installation requested')
    page.evaluate("window.dispatchEvent(new Event('appinstalled'))")
    expect(page.get_by_role('heading',name='You’re all set.')).to_be_visible()
    expect(page.get_by_role('link',name='Add to home screen',exact=True)).to_have_count(0)
    assert page.evaluate('window.installPromptCalls')==3
    assert page.evaluate('document.documentElement.scrollWidth')<=1440
    context.close()
    profile.cleanup()
    print('PASS native install acceptance, dismissal, error recovery and installed-state UI',flush=True)

    for device,ua,touch in [
      ('iphone','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',False),
      ('ipad','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',True),
      ('android','Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',False),
    ]:
      context,page,_ = contract['new_context'](browser,None,390)
      context.add_init_script('Object.defineProperty(navigator,"userAgent",{get:()=>'+json.dumps(ua)+'});'+('Object.defineProperty(navigator,"platform",{get:()=>"MacIntel"});Object.defineProperty(navigator,"maxTouchPoints",{get:()=>5});' if touch else ''))
      page.goto(BASE+'/install/',wait_until='networkidle')
      selected = 'Android' if device=='android' else 'iPhone / iPad'
      expect(page.get_by_role('button',name=selected,exact=True)).to_have_attribute('aria-pressed','true')
      if device!='android':expect(page.locator('.install-steps')).to_contain_text('Open as Web App')
      page.get_by_role('button',name='Open navigation',exact=True).click()
      page.get_by_role('navigation',name='Mobile navigation').get_by_role('link',name='Add to home screen',exact=True).click()
      expect(page.get_by_role('navigation',name='Mobile navigation')).to_have_count(0)
      assert page.evaluate('document.documentElement.scrollWidth')<=390
      page.screenshot(path=f'artifacts/install-{device}-390.png',full_page=True)
      context.close()
    print('PASS iPhone, iPad desktop-mode and Android instructions; mobile navigation and layout',flush=True)

    context,page,_ = contract['new_context'](browser,'captain',390)
    context.add_init_script('Object.defineProperty(navigator,"standalone",{get:()=>true});')
    page.goto(BASE+'/install/',wait_until='networkidle')
    expect(page.get_by_role('heading',name='You’re all set.')).to_be_visible()
    page.get_by_role('link',name='Open Team area',exact=True).click()
    expect(page.locator('.formation-pitch')).to_be_visible()
    expect(page.get_by_role('link',name='Add to home screen',exact=True)).to_have_count(0)
    assert page.evaluate('localStorage.getItem("mauve-fc-auth")')
    assert not page.evaluate('JSON.stringify({...localStorage}).includes("Private Member")')
    assert page.evaluate('caches.keys()')==[]
    assert page.evaluate('navigator.serviceWorker.getRegistrations().then(r=>r.length)')==0
    page.get_by_role('button',name='Sign out',exact=True).click()
    expect(page.get_by_role('link',name='Team sign-in',exact=True)).to_be_visible()
    assert 'Private Member' not in page.locator('main').inner_text()
    context.close()
    print('PASS standalone launch/sign-in, sign-out clearing and no offline cache of private roster',flush=True)

    context,page,_ = contract['new_context'](browser,None,390)
    context.route(contract['API']+'/rest/v1/rpc/get_public_club',lambda route:route.fulfill(status=503,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body='{}'))
    page.goto(BASE+'/install/',wait_until='networkidle')
    expect(page.get_by_role('heading',name='Your club. One tap away.')).to_be_visible()
    context.close()
    assert not contract['errors'],contract['errors']
    browser.close()
    print('PASS installation help remains available when club-data requests fail; no browser errors',flush=True)
