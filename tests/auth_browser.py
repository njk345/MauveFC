"""Browser contract test against tests/mock-supabase.py and a live-mode Next dev server.
This verifies app behavior with a mock identity service, not real email delivery.
"""
from playwright.sync_api import sync_playwright,expect
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':390,'height':844})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:3001/captain/',wait_until='networkidle')
 expect(page.get_by_role('link',name='Captain sign-in',exact=True)).to_be_visible()
 expect(page.get_by_role('button',name='Save draft')).to_have_count(0)
 page.get_by_role('link',name='Captain sign-in',exact=True).click()
 page.get_by_role('textbox',name='Invited email').fill('captain@example.com')
 page.get_by_role('button',name='Send sign-in link').click()
 page.get_by_role('button',name='Use a sign-in code instead').click()
 page.get_by_role('textbox',name='Email code').fill('000000')
 page.get_by_role('button',name='Verify & sign in').click()
 expect(page.locator('.auth-error')).to_contain_text('invalid or expired')
 page.get_by_role('textbox',name='Email code').fill('123456')
 page.get_by_role('button',name='Verify & sign in').click()
 expect(page.get_by_role('button',name='Save draft',exact=True)).to_be_visible(timeout=20000)
 assert page.locator('input[aria-label="Mauve FC official score"]').input_value()=='0'
 page.get_by_role('button',name='Save draft',exact=True).click()
 expect(page.locator('.form-errors')).to_contain_text('changed since you opened')
 expect(page.locator('.publish-success')).to_have_count(0)
 assert page.evaluate("localStorage.getItem('mauve-fc-prototype-v1')") is None
 page.get_by_role('navigation',name='Captain tools').get_by_role('link',name='Fixtures',exact=True).click()
 expect(page.get_by_role('button',name='Add fixture',exact=True)).to_be_visible()
 page.get_by_role('button',name='Add fixture',exact=True).click()
 expect(page.get_by_role('textbox',name='Opponent',exact=True)).to_be_visible()
 assert page.evaluate('document.documentElement.scrollWidth')==390
 page.get_by_role('button',name='Sign out',exact=True).click()
 expect(page.get_by_role('link',name='Captain sign-in',exact=True)).to_be_visible()
 expect(page.get_by_role('button',name='Add fixture',exact=True)).to_have_count(0)
 print('PASS invited sign-in, invalid code, captain gate, conflict error, no browser-local live writes, sign-out',flush=True)
 page.goto('http://localhost:3001/login/',wait_until='networkidle')
 page.get_by_role('textbox',name='Invited email').fill('member@example.com')
 page.get_by_role('button',name='Send sign-in link').click()
 page.get_by_role('button',name='Use a sign-in code instead').click()
 page.get_by_role('textbox',name='Email code').fill('123456')
 page.get_by_role('button',name='Verify & sign in').click()
 expect(page.get_by_text('Your account doesn’t have captain access for this club.')).to_be_visible(timeout=15000)
 expect(page.get_by_role('button',name='Save draft',exact=True)).to_have_count(0)
 page.goto('http://localhost:3001/captain/roster/',wait_until='networkidle')
 expect(page.get_by_text('Your account doesn’t have captain access for this club.')).to_be_visible()
 expect(page.get_by_role('button',name='Add player',exact=True)).to_have_count(0)
 assert not errors,errors
 print('PASS signed-in non-captain denied on result and roster routes; zero browser errors',flush=True)
 b.close()
