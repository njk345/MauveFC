"use client";
import Link from "next/link";
import { playerHref } from "@/lib/player-link";
import { ArrowRight, ArrowUpRight, MoveUpRight } from "lucide-react";
import { usePrototype } from "./prototype-provider";
import {
  playerStats,
  publishedMatches,
  teamStats,
  outcome,
} from "@/features/stats/queries";
import { Crest, Jersey, OpponentBadge } from "./brand";
import { FixtureCard } from "./matches";
import { HomeStandings } from "./home-standings";
export function HomePage() {
  const { matches, seasonId, seasons, players, live } = usePrototype(),
    season = seasons.find((s) => s.id === seasonId)!;
  const fixtures = matches.filter((m) => m.seasonId === seasonId),
    completed = publishedMatches(fixtures),
    latest = completed.at(-1),
    next = fixtures.find(
      (m) =>
        m.status === "scheduled" &&
        !m.result?.published &&
        (!live || !m.kickoff || Date.parse(m.kickoff) >= Date.now()),
    ),
    stats = teamStats(fixtures),
    leaders = playerStats(
      fixtures,
      players.filter((p) => p.isPublic !== false),
    ).slice(0, 3);
  return (
    <>
      <section className="hero hero-compact">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-cross">✳</span> BROOKLYN’S OWN. EVERY
            THURSDAY.
          </div>
          <h1>
            A LITTLE GRIT.
            <br />A LOT OF <span>MAUVE.</span>
          </h1>
          <p>Good football. Better company.</p>
          <div className="hero-actions">
            <Link className="button" href="/schedule/">
              Find our next match <ArrowUpRight size={18} />
            </Link>
            <Link className="text-link" href="/players/">
              Meet the squad <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
      <section className="section home-match-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              {season.name} / {stats.played} MATCHES PLAYED
            </span>
            <h2>Every match matters.</h2>
          </div>
          <Link className="text-link" href="/schedule/">
            Full schedule <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="home-season-summary" aria-label="Current club record">
          {[
            [stats.points, "POINTS"],
            [stats.wins, "WON"],
            [stats.draws, "DRAWN"],
            [stats.losses, "LOST"],
            [
              `${stats.goalDifference > 0 ? "+" : ""}${stats.goalDifference}`,
              "GOAL DIFF.",
            ],
          ].map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="home-match-grid">
          {next ? (
            <FixtureCard match={next} />
          ) : (
            <article className="fixture-card season-over">
              <Crest />
              <h2>
                {live && !stats.played
                  ? "A new chapter awaits."
                  : "That’s a wrap."}
              </h2>
              <p>
                {live
                  ? stats.played
                    ? "No upcoming matches are scheduled. See how we finished."
                    : "The season is taking shape. Check back for the first fixture."
                  : "The sample season is complete. See how we finished."}
              </p>
              <Link
                href={stats.played ? "/results/" : "/schedule/"}
                className="button light"
              >
                {stats.played ? "Explore results" : "Explore fixtures"}{" "}
                <ArrowRight size={16} />
              </Link>
            </article>
          )}
          <HomeStandings
            seasonId={seasonId}
            completed={completed}
            live={live}
          />
        </div>
      </section>
      <div className="club-ribbon">
        <span>ONE CLUB.</span>
        <span>OUR CITY.</span>
        <span>OUR COLOURS.</span>
        <span className="ribbon-star">✳</span>
        <span>THURSDAY NIGHTS.</span>
        <span>MAUVE FOREVER.</span>
        <span className="ribbon-star">✳</span>
      </div>
      <section className="section home-latest">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FRESH OFF THE PITCH</span>
            <h2>The latest chapter.</h2>
          </div>
          <Link className="text-link" href="/results/">
            All results <ArrowUpRight size={16} />
          </Link>
        </div>
        {latest && (
          <div className="latest-match">
            <div className="latest-label">
              <span className="eyebrow">FULL TIME</span>
              <span>
                {season.name} · Matchday {latest.round}
              </span>
            </div>
            <div className="latest-score">
              <span className="latest-team">
                <Crest small />
                <strong>Mauve FC</strong>
              </span>
              <div className="big-score">
                {latest.result!.home}
                <span>:</span>
                {latest.result!.away}
              </div>
              <span className="latest-team opponent">
                <strong>{latest.opponent}</strong>
                <OpponentBadge
                  small
                  code={latest.opponentCode}
                  color={latest.color}
                />
              </span>
            </div>
            <div className="latest-note">
              <span className={`result-word result-${outcome(latest)}`}>
                {outcome(latest) === "W"
                  ? "THREE POINTS. ALL MAUVE."
                  : outcome(latest) === "D"
                    ? "A POINT TO BUILD ON."
                    : "WE GO AGAIN."}
              </span>
              <Link href="/results/">
                Match details <MoveUpRight size={15} />
              </Link>
            </div>
          </div>
        )}
      </section>
      {leaders.length > 0 && (
        <section className="section squad-preview">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE PEOPLE IN MAUVE</span>
              <h2>A team effort. Always.</h2>
            </div>
            <Link className="text-link" href="/players/">
              Meet the squad <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="leader-preview-grid">
            {leaders.map((p, i) => (
              <Link
                className="leader-preview"
                key={p.id}
                href={playerHref(p.id)}
              >
                <div className={`jersey-preview jersey-tone-${i}`}>
                  <span className="jersey-corner">
                    {String(i + 1).padStart(2, "0")} / ON THE SCORESHEET
                  </span>
                  <Jersey number={p.number} />
                  <ArrowUpRight className="jersey-arrow" size={22} />
                </div>
                <div className="leader-preview-info">
                  <div>
                    <span className="eyebrow">{p.position}</span>
                    <h3>{p.name}</h3>
                  </div>
                  <div className="preview-goals">
                    <strong>{p.goals}</strong>
                    <span>GOALS</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="club-note">
        <span className="eyebrow">MORE THAN THE FINAL SCORE</span>
        <h2>
          THE CITY IS BIG.
          <br />
          OUR CORNER IS <em>MAUVE.</em>
        </h2>
        <p>
          From the first whistle to the post-match hang.
          <br />
          This is our kind of Thursday.
        </p>
        <Link href="/players/" className="text-link">
          Get to know the club <ArrowUpRight size={17} />
        </Link>
        <div className="note-mark" aria-hidden="true">
          M
        </div>
      </section>
    </>
  );
}
