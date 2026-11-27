"""Run against the live-mode preview. API requests use synthetic club data."""

from playwright.sync_api import sync_playwright, expect
from stats_view_browser import API, BASE, data, errors, ids, new_context


def return_to_tab(page):
    # Chromium headless can keep all tabs visible. Drive the visibility
    # transition through the real Supabase client's listener.
    page.evaluate("""() => {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true, value: 'hidden'
        });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        delete document.visibilityState;
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        window.dispatchEvent(new Event('focus'));
    }""")


def recheck(page):
    with page.expect_response(lambda r: r.url.endswith('/get_team_access') and r.request.method == 'POST'):
        return_to_tab(page)


def verify_season(page):
    page.goto(BASE + '/captain/season/')
    page.get_by_role('button', name='Add a season', exact=True).click()
    form = page.locator('.season-setup-form')
    form.get_by_label('Team name this season', exact=True).fill('Test Team')
    form.get_by_label('League name', exact=True).fill('Test League')
    form.get_by_label('League location', exact=True).fill('Test Pitch')
    form.get_by_role('button', name='Continue', exact=True).click()
    standings = form.get_by_role('combobox', name='Construct manual standings', exact=True)
    standings.select_option('yes')
    teams = form.get_by_role('textbox', name='Other teams in this league · one per line', exact=True)
    teams.fill('Other FC')
    recheck(page)
    expect(standings).to_have_value('yes')
    expect(teams).to_have_value('Other FC')


def verify_new_player(page):
    page.goto(BASE + '/captain/roster/')
    page.get_by_role('button', name='Add player', exact=True).click()
    name = page.get_by_role('textbox', name='Player name', exact=True)
    name.fill('Unsaved Player')
    recheck(page)
    expect(name).to_have_value('Unsaved Player')


def verify_lineup(context, page, state, respond):
    page.goto(BASE + '/team/')
    match = page.get_by_role('combobox', name='Match', exact=True)
    original = match.input_value()
    page.get_by_role('button', name='Create a lineup', exact=True).click()
    formation = page.get_by_role('combobox', name='Formation', exact=True)
    formation.select_option('3-2-1')
    starter = page.locator('.formation-slot select').first
    starter.select_option(ids[1])

    def service_error(status, message):
        def handle(route):
            if route.request.method == 'OPTIONS':
                respond(route, None)
            else:
                respond(route, {'message': message}, status)
        return handle

    team_url = API + '/rest/v1/rpc/get_team_club'
    fail = service_error(503, 'Temporary network failure')
    context.route(team_url, fail)
    recheck(page)
    expect(page.get_by_role('status').filter(has_text='Use Refresh team')).to_be_visible()
    expect(formation).to_have_value('3-2-1')
    expect(starter).to_have_value(ids[1])
    context.unroute(team_url, fail)

    # A new upcoming fixture would otherwise replace the implicit choice.
    upcoming = {**data['matches'][0], 'id': 'new-fixture', 'opponent': 'New FC',
                'status': 'scheduled', 'kickoff': '2099-01-01T19:00:00Z'}
    upcoming.pop('result', None)
    data['matches'].append(upcoming)
    try:
        recheck(page)
        expect(match.locator('option[value="new-fixture"]')).to_have_count(1)
        expect(match).to_have_value(original)
        expect(formation).to_have_value('3-2-1')
        expect(starter).to_have_value(ids[1])

        page.once('dialog', lambda dialog: dialog.accept())
        match.select_option('new-fixture')
        expect(formation).to_have_count(0)
        expect(match).to_have_value('new-fixture')
    finally:
        data['matches'].remove(upcoming)

    # A verified loss of membership must still close the private workspace.
    context.route(team_url, service_error(403, 'Team access required'))
    state['kind'] = 'outsider'
    recheck(page)
    expect(page.get_by_text('Your account does not have team access.', exact=False)).to_be_visible()
    expect(page.locator('.formation-pitch')).to_have_count(0)
    page.wait_for_load_state('networkidle')


if __name__ == '__main__':
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        for width in [1440, 390]:
            context, page, state, respond = new_context(browser, 'captain', width)
            verify_season(page)
            verify_new_player(page)
            verify_lineup(context, page, state, respond)
            context.close()
        assert not errors, errors
        browser.close()
    print('PASS season wizard, new player and lineup stay open on refocus. Explicit match change and revoked access close the lineup.')
