"""Captain roster additions reuse club identities; all services intercepted."""
import copy
from pathlib import Path

from playwright.sync_api import sync_playwright, expect
from stats_view_browser import API, BASE, OLD, S, data, errors, ids, names, new_context

initial = copy.deepcopy(data)
initial['roster'] = [dict(seasonId=s, playerId=pid) for s, pid in
                     [(S, ids[0]), (S, ids[1]), (OLD, ids[2]), (OLD, ids[3])]]
initial['players'][3].update(
    captainDetails=dict(email='sub@example.test', phone='212 555 0101', relationshipNote='Club friend', revision=7),
    preferredPositions=['Goalkeeper', 'Right back'],
)
initial['matches'][0]['guestPlayerIds'] = [ids[3]]


def setup(browser, width=1440, kind='captain'):
    data.clear()
    data.update(copy.deepcopy(initial))
    context, page, state, respond = new_context(browser, kind, width)
    state.update(saves=[], fail=False, hold=False, pending=[])

    def save(route):
        if route.request.method == 'OPTIONS':
            respond(route, None)
            return
        assert state['kind'] == 'captain'
        body = route.request.post_data_json
        state['saves'].append(body)
        if state['fail']:
            respond(route, dict(code='40001', message='Player details changed. Reload and try again.'), 409)
            return
        player = body['p_player']
        assert player == next(p for p in data['players'] if p['id'] == player['id'])
        membership = dict(seasonId=body['p_season_id'], playerId=player['id'])
        if membership not in data['roster']:
            data['roster'].append(membership)
        if state['hold']:
            state['pending'].append(route)
        else:
            respond(route, player['id'])

    context.route(API+'/rest/v1/rpc/save_roster_player', save)
    return context, page, state, respond


def choose(page, player_id, query):
    page.get_by_role('button', name='Add from directory', exact=True).click()
    form = page.get_by_role('form', name='Add an existing player', exact=True)
    form.get_by_label('Search directory', exact=True).fill(query)
    form.get_by_role('combobox', name='Known player', exact=True).select_option(player_id)
    return form


def layout(page, width):
    assert page.evaluate('document.documentElement.scrollWidth') <= width, (width, page.url)


if __name__ == '__main__':
    Path('artifacts').mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        for width in [1440, 390, 320]:
            context, page, state, respond = setup(browser, width)
            page.goto(BASE+'/captain/roster/', wait_until='networkidle')
            entries = page.locator('.management-list > button')
            expect(entries).to_have_count(2)
            form = choose(page, ids[2], '  PRIVATE MEMBER 2  ')
            expect(form.get_by_role('combobox', name='Known player', exact=True).locator('option')).to_have_count(2)
            expect(form.locator('.roster-directory-preview')).to_contain_text('Previously on a season roster.')
            page.screenshot(path=f'artifacts/roster-directory-{width}.png', full_page=True)
            layout(page, width)
            form.get_by_role('button', name='Add to season roster', exact=True).click()
            expect(entries).to_have_count(3)
            expect(entries.last).to_contain_text(names[2])
            assert state['saves'][-1]['p_player']['id'] == ids[2]
            assert state['saves'][-1]['p_season_id'] == S
            assert dict(seasonId=OLD, playerId=ids[2]) in data['roster']
            assert data['players'] == initial['players']
            assert data['matches'] == initial['matches']
            expect(form.get_by_role('combobox', name='Known player', exact=True).locator(f'option[value="{ids[2]}"]')).to_have_count(0)
            form.get_by_label('Search directory', exact=True).fill(names[0])
            expect(form).to_contain_text('No players match this search.')
            expect(form.get_by_role('button', name='Add to season roster', exact=True)).to_be_disabled()
            form.get_by_label('Search directory', exact=True).fill('not a known name')
            expect(form).to_contain_text('No players match this search.')
            page.get_by_role('button', name='Add player', exact=True).click()
            expect(page.get_by_role('form', name='Add an existing player', exact=True)).to_have_count(0)
            expect(page.get_by_label('Player name', exact=True)).to_have_value('')
            form = choose(page, ids[3], names[3])
            expect(form.locator('.roster-directory-preview')).to_contain_text('Private profile')
            state['fail'] = True
            form.get_by_role('button', name='Add to season roster', exact=True).click()
            expect(form.get_by_role('alert')).to_contain_text('Player details changed.')
            expect(entries).to_have_count(3)
            state['fail'] = False
            form.get_by_role('button', name='Reload directory', exact=True).click()
            expect(form.get_by_role('alert')).to_have_count(0)
            expect(form.get_by_role('combobox', name='Known player', exact=True)).to_have_value('')
            form.get_by_role('combobox', name='Known player', exact=True).select_option(ids[3])
            state['hold'] = True
            form.get_by_role('button', name='Add to season roster', exact=True).click()
            expect(form.get_by_role('button', name='Adding…', exact=True)).to_be_disabled()
            expect(page.get_by_role('button', name='Add player', exact=True)).to_be_disabled()
            expect(page.get_by_role('button', name='Add from directory', exact=True)).to_be_disabled()
            assert len(state['pending']) == 1
            page.get_by_role('combobox', name='Season', exact=True).select_option(OLD)
            expect(page.get_by_role('form', name='Add an existing player', exact=True)).to_have_count(0)
            respond(state['pending'].pop(), ids[3])
            expect(entries).to_have_count(2)
            page.get_by_role('combobox', name='Season', exact=True).select_option(S)
            expect(entries).to_have_count(4)
            assert dict(seasonId=S, playerId=ids[3]) in data['roster']
            assert dict(seasonId=OLD, playerId=ids[3]) in data['roster']
            assert data['players'] == initial['players']
            assert data['matches'] == initial['matches']
            assert len(data['players']) == len(initial['players'])
            layout(page, width)
            context.close()

        context, page, _, _ = setup(browser, 390)
        data['roster'] += [dict(seasonId=S, playerId=pid) for pid in ids[2:]]
        page.goto(BASE+'/captain/roster/', wait_until='networkidle')
        page.get_by_role('button', name='Add from directory', exact=True).click()
        expect(page.get_by_role('form', name='Add an existing player', exact=True)).to_contain_text('Every known player is already on this season’s roster.')
        expect(page.get_by_role('button', name='Add to season roster', exact=True)).to_be_disabled()
        context.close()

        for kind in [None, 'player', 'outsider']:
            context, page, _, _ = setup(browser, 390, kind)
            page.goto(BASE+'/captain/roster/', wait_until='networkidle')
            expect(page.get_by_role('button', name='Add from directory', exact=True)).to_have_count(0)
            context.close()
        assert not errors, errors
        browser.close()
        print('PASS existing-player search/add, season and guest identity preservation, private details unchanged, duplicate exclusions, new-player flow, empty/no-match states, error/reload/retry, busy controls and in-flight season changes, captain-only access, 1440/390/320px; no production writes.')
