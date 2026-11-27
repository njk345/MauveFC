"""Profile links, dual groups and updated formation roles against synthetic APIs."""

import copy
import re

from playwright.sync_api import expect, sync_playwright

from stats_view_browser import API, BASE, M, data, errors, ids, names, new_context


def verify(browser, width):
    context, page, state, respond = new_context(browser, 'captain', width)
    original = copy.deepcopy(data['players'][1])
    saved = []

    def save_player(route):
        if route.request.method == 'OPTIONS':
            respond(route, None)
            return
        player = route.request.post_data_json['p_player']
        assert player['id'] == ids[1]
        data['players'][1] = player
        respond(route, player['id'])

    def save_lineup(route):
        if route.request.method == 'OPTIONS':
            respond(route, None)
            return
        body = route.request.post_data_json
        assert body['p_match_id'] == M and body['p_publish'] is True
        saved.append(body['p_payload'])
        respond(route, None)

    def lineup_posts(route):
        if route.request.method == 'OPTIONS':
            respond(route, None)
        else:
            respond(route, [dict(
                id='new-official', matchId=M, kind='official', payload=saved[-1],
                authorName='Test Captain', createdAt='2026-11-24T12:00:00Z', canDelete=False,
            )] if saved else [])

    context.route(API + '/rest/v1/rpc/save_roster_player', save_player)
    context.route(API + '/rest/v1/rpc/save_match_lineup', save_lineup)
    context.route(API + '/rest/v1/rpc/get_lineup_posts', lineup_posts)
    try:
        page.goto(BASE + '/captain/roster/', wait_until='networkidle')
        page.locator('.management-list').get_by_role('button', name=re.compile(names[1])).click()
        main = page.get_by_role('combobox', name='Primary position group', exact=True)
        second = page.get_by_role('combobox', name='Second position group · optional', exact=True)
        main.select_option('Defender')
        expect(second.get_by_role('option', name='Defender', exact=True)).to_have_count(0)
        second.select_option('Goalkeeper')
        page.get_by_role('button', name='Save player', exact=True).click()
        expect(main).to_have_count(0)
        assert data['players'][1]['position'] == 'Defender'
        assert data['players'][1]['secondaryPosition'] == 'Goalkeeper'

        page.goto(BASE + '/team/', wait_until='networkidle')
        page.get_by_role('button', name=re.compile('^Private roster')).click()
        profile = page.locator('.team-player-card').filter(has_text=names[1])
        expect(profile).to_contain_text('Defender / Goalkeeper')
        profile.click()
        expect(page.get_by_role('heading', name=names[1], exact=True)).to_be_visible()
        expect(page.locator('.profile-bio')).to_contain_text('Defender / Goalkeeper')

        page.goto(BASE + '/players/', wait_until='networkidle')
        page.get_by_role('combobox', name='Filter by position').select_option('Goalkeeper')
        expect(page.locator('.player-card').filter(has_text=names[1])).to_be_visible()

        page.goto(BASE + '/team/', wait_until='networkidle')
        page.get_by_role('combobox', name='Match', exact=True).select_option(M)
        page.get_by_role('button', name='Create a lineup', exact=True).click()
        page.get_by_text('Customize position roles', exact=True).click()
        page.get_by_role('combobox', name='CM position role', exact=True).select_option('Defensive midfield')
        cm = page.locator('[data-slot="CM"] .formation-position')
        expect(cm).to_have_text('DM')
        expect(cm).to_have_attribute('title', 'Defensive midfield')
        for i, position in enumerate(['GK', 'LB', 'RB', 'LM', 'CM', 'RM', 'ST']):
            page.get_by_role('combobox', name=f'Starter {position}', exact=True).select_option(ids[i])
        assert page.evaluate('document.documentElement.scrollWidth') <= width
        page.get_by_role('button', name='Publish official lineup', exact=True).click()
        expect(page.get_by_text('Official lineup shared with the team.', exact=True)).to_be_visible()
        assert saved[-1]['slotPositions'] == {'4': 'Defensive midfield'}
        expect(cm).to_have_text('DM')
    finally:
        data['players'][1] = original
        context.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        for width in [1440, 390, 320]:
            verify(browser, width)
        assert not errors, errors
        browser.close()
    print('PASS role editing, private roster career links, second-group filtering and publishing customized roles.')
