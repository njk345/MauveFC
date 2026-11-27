"""Archive regressions against a live-mode preview with synthetic API data."""

import copy
import csv
import io
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from stats_view_browser import API, BASE, OLD, S, card, data, errors, ids, names, new_context

THIRD = '66666666-6666-4666-8666-666666666668'
HISTORY = copy.deepcopy(data['matches'][0])
HISTORY.update(id='historical-final', seasonId=OLD, opponent='Historical United', playoffRound='finals')
HISTORY['result'] = {
    **HISTORY['result'], 'home': 3, 'away': 1, 'scorers': 'complete', 'assists': 'unrecorded',
    'stats': [
        dict(playerId=ids[0], appeared=True, goals=0, assists=None),
        dict(playerId=ids[1], appeared=True, goals=2, assists=None),
        dict(playerId=ids[2], appeared=True, goals=1, assists=None),
    ],
}


def install_routes(context, state, respond):
    def club(route):
        if route.request.method == 'OPTIONS':
            respond(route, None)
            return
        snapshot = copy.deepcopy(data)
        public_ids = {p['id'] for p in data['players'] if p['isPublic']}
        snapshot['players'] = [p for p in snapshot['players'] if p['id'] in public_ids]
        snapshot['roster'] = [r for r in snapshot['roster'] if r['playerId'] in public_ids]
        for match in snapshot['matches']:
            match['result']['stats'] = [
                row for row in match['result']['stats'] if row['playerId'] in public_ids
            ]
        respond(route, snapshot)

    def stats(route):
        if route.request.method == 'OPTIONS':
            respond(route, None)
            return
        requested = route.request.post_data_json['p_season_ids']
        state['scopes'].append(requested)
        team = state['kind'] in ['player', 'captain']
        players = data['players'][:3] if team else [data['players'][0], data['players'][2]]
        rows = [
            {**p, 'appearances': (1 if p['id'] == ids[2] else 2),
             'goals': {ids[0]: 1, ids[1]: 4, ids[2]: 1}[p['id']],
             'assists': {ids[0]: 1, ids[1]: 4, ids[2]: 0}[p['id']],
             'appearancesKnown': True, 'goalsKnown': True,
             'assistsKnown': p['id'] != ids[2]}
            for p in players
        ]
        respond(route, dict(
            teamView=team, privatePlayerCount=0 if team else 1, players=rows,
            assistsTotal=5, assistsRecordedMatches=1, assistsCompleteMatches=0,
            appearanceRecords=2, goalRecords=2,
        ))

    context.route(API + '/rest/v1/rpc/get_public_club', club)
    context.route(API + '/rest/v1/rpc/get_archive_stats', stats)


def assert_mobile_fit(page, width):
    assert page.evaluate('document.documentElement.scrollWidth') <= width


if __name__ == '__main__':
    data['seasons'][0].update(name='Fall 2026', year=2026, term='Fall', competition='NYC Soccer')
    data['seasons'][1].update(name='Winter 2025', year=2025, term='Winter', competition='NYC Footy')
    data['seasons'].append(dict(id=THIRD, name='Fall 2024', competition='NYC Soccer', format='7v7'))
    data['matches'].append(HISTORY)
    data['roster'] = [dict(seasonId=s, playerId=p) for s, p in [(S, ids[0]), (S, ids[1]), (OLD, ids[0]), (OLD, ids[2])]]
    data['players'][2].update(isPublic=True, bio='Played three positions.', hometown='Brooklyn')
    data['players'][1]['captainDetails'] = dict(email='captain-secret@example.test', phone='', relationshipNote='Private', revision=0)
    artifact = Path('/tmp/mauve-archive-shots')
    artifact.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        for width in [1440, 390, 320]:
            for kind in [None, 'captain']:
                context, page, state, respond = new_context(browser, kind, width)
                state['scopes'] = []
                install_routes(context, state, respond)
                page.goto(BASE + '/stats/', wait_until='networkidle')
                expect(card(page, 'MATCHES PLAYED')).to_have_text('2')
                page.get_by_role('button', name='All seasons', exact=True).click()
                expect(card(page, 'MATCHES PLAYED')).to_have_text('3')
                expect(card(page, 'GOALS SCORED')).to_have_text('11')
                expect(card(page, 'GOAL DIFFERENCE')).to_have_text('+8')
                expect(card(page, 'ASSISTS RECORDED')).to_have_text('5')
                assert state['scopes'][-1] == [S, OLD, THIRD]
                expect(page.locator('.archive-records li')).to_have_count(3)
                expect(page.locator('.archive-records')).to_contain_text('No published results')
                expect(page.locator('.leaderboard-table tbody tr')).to_have_count(3)
                expect(page.locator('.private-stats-row')).to_have_count(0 if kind else 1)
                expect(page.locator('.leaderboard-table')).to_contain_text(names[1] if kind else 'Private player')
                assert_mobile_fit(page, width)
                if not kind:
                    page.screenshot(path=str(artifact / f'stats-{width}.png'), full_page=True)
                    expect(page.get_by_role('button', name='Player stats CSV')).to_have_count(0)
                    expect(page.locator('main')).not_to_contain_text(names[1])

                page.get_by_role('button', name='Choose seasons', exact=True).click()
                checkboxes = page.locator('.archive-season-options')
                checkboxes.get_by_role('checkbox', name='Winter 2025 · NYC Footy').check()
                expect(card(page, 'ASSISTS RECORDED')).to_have_text('5')
                assert state['scopes'][-1] == [S, OLD]
                expect(page.locator('.archive-records li')).to_have_count(2)
                if kind:
                    with page.expect_download() as download:
                        page.get_by_role('button', name='Player stats CSV').click()
                    csv_rows = list(csv.DictReader(io.StringIO(download.value.path().read_text(encoding='utf-8-sig'))))
                    assert len(csv_rows) == 5 and any(row['Player'] == names[1] for row in csv_rows)
                    assert {row['Season ID'] for row in csv_rows} == {S, OLD}
                    assert 'captain-secret@example.test' not in str(csv_rows)
                    assert any(row['Assists'] == '' and row['Goals'] == '0' for row in csv_rows)

                page.goto(BASE + '/players/', wait_until='networkidle')
                page.get_by_role('button', name='All profiles', exact=True).click()
                page.locator('.player-card').filter(has_text=names[2]).click()
                expect(page.locator('h1')).to_have_text(names[2])
                expect(page.locator('.career-seasons')).to_contain_text('Winter 2025 · NYC Footy')
                expect(page.locator('.profile-bio')).to_contain_text('Played three positions.')
                page.locator('.career-seasons').get_by_role('button', name='Assists', exact=True).click()
                expect(page.locator('.career-active-metric strong')).to_have_text('—')
                assert_mobile_fit(page, width)
                if not kind:
                    page.screenshot(path=str(artifact / f'profile-{width}.png'), full_page=True)

                page.goto(BASE + '/players/profile/?id=' + ids[0], wait_until='networkidle')
                expect(page.locator('.career-seasons li')).to_have_count(2)
                expect(page.locator('.appearance-row')).to_have_count(2)
                page.get_by_role('combobox', name='Appearance season', exact=True).select_option(OLD)
                expect(page.locator('.appearance-row')).to_have_count(1)
                expect(page.locator('.appearance-row')).to_contain_text('Historical United')
                page.goto(BASE + '/players/profile/?id=' + ids[1], wait_until='networkidle')
                expect(page.locator('h1')).to_have_text(names[1] if kind else 'Player not found.')
                expect(page.locator('main')).not_to_contain_text('captain-secret@example.test')
                context.close()
        assert not errors, errors
        browser.close()
    print('PASS all/current/custom seasons, comparisons, career profiles, unknown values, private visibility, CSV export and mobile layouts.')
