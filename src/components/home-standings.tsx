import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Match } from "@/lib/types";
import { outcome } from "@/features/stats/queries";
import { FormBadge } from "./matches";
import { usePrototype } from "./prototype-provider";
import { LeagueUpdated } from "./league-connection";

// An illustrative, fixed matchday-six snapshot, never presented as live league data.
const sampleTable = [
  { club: "Parkside United", played: 6, difference: 9, points: 15 },
  { club: "Mauve FC", played: 6, difference: 7, points: 13 },
  { club: "East River FC", played: 6, difference: 1, points: 10 },
  { club: "Dumbo Athletic", played: 6, difference: 0, points: 8 },
  { club: "Crown Heights FC", played: 6, difference: -3, points: 7 },
  { club: "Northside FC", played: 6, difference: -4, points: 5 },
  { club: "Sunday Service", played: 6, difference: -10, points: 1 },
];

export function HomeStandings({
  seasonId,
  completed,
  live = false,
}: {
  seasonId: string;
  completed: Match[];
  live?: boolean;
}) {
  const { league } = usePrototype();
  if (live && league?.seasonId === seasonId && league.standings.length)
    return (
      <article className="home-standings">
        <div className="standings-heading">
          <div>
            <h3>League standings</h3>
            <p>NYCSoccer · {league.teamName}</p>
          </div>
          <span className="pill">
            {league.standings.find((r) => r.teamId === league.teamId)?.position}{" "}
            / {league.standings.length}
          </span>
        </div>
        <table className="home-standings-table">
          <caption className="sr-only">
            Official LeagueApps standings in league order
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">CLUB</th>
              <th scope="col">
                <abbr title="Played">P</abbr>
              </th>
              <th scope="col">
                <abbr title="Goal difference">GD</abbr>
              </th>
              <th scope="col">
                <abbr title="Points">PTS</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {league.standings.map((row) => (
              <tr
                key={row.teamId}
                className={
                  row.teamId === league.teamId ? "mauve-standing" : undefined
                }
              >
                <td>{row.position}</td>
                <th scope="row">
                  {row.name}
                  {row.teamId === league.teamId && (
                    <span className="our-club-dot" aria-label="Our club" />
                  )}
                </th>
                <td>{row.played}</td>
                <td>
                  {row.difference > 0 ? "+" : ""}
                  {row.difference}
                </td>
                <td>{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="standings-form">
          <div>
            <span className="eyebrow">CLUB FORM</span>
            <div className="form-group">
              {completed.slice(-5).map((m) => (
                <FormBadge key={m.id} value={outcome(m)} />
              ))}
            </div>
          </div>
          <a
            className="text-link"
            href="https://nycsoccer.leagueapps.com/leagues/5162244/standings"
            target="_blank"
            rel="noreferrer"
          >
            League table <ArrowUpRight size={15} />
          </a>
        </div>
        <LeagueUpdated league={league} />
      </article>
    );
  if (live)
    return (
      <article className="home-standings">
        <div className="standings-heading">
          <h3>Our season</h3>
        </div>
        <div className="friendly-summary">
          <h3>Every point earned.</h3>
          <p>
            The club record reflects published results. League standings will
            appear once a verified source is connected.
          </p>
          <Link className="text-link" href="/stats/">
            Explore club statistics <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="standings-form">
          <div>
            <span className="eyebrow">CLUB FORM</span>
            <div className="form-group">
              {completed.slice(-5).map((m) => (
                <FormBadge key={m.id} value={outcome(m)} />
              ))}
            </div>
          </div>
        </div>
      </article>
    );
  return (
    <article className="home-standings">
      <div className="standings-heading">
        <div>
          <h3>
            {seasonId === "fall-2026" ? "League snapshot" : "Summer in mauve"}
          </h3>
          <p>
            {seasonId === "fall-2026"
              ? "Fictional standings · Matchday 6"
              : "Sample friendlies · Summer 2026"}
          </p>
        </div>
        <span className="pill">SAMPLE</span>
      </div>
      {seasonId === "fall-2026" ? (
        <table className="home-standings-table">
          <caption className="sr-only">
            Fictional league standings after matchday six. This fixed sample
            snapshot does not change with local result edits.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Position</span>#
              </th>
              <th scope="col">CLUB</th>
              <th scope="col">
                <abbr title="Played">P</abbr>
              </th>
              <th scope="col">
                <abbr title="Goal difference">GD</abbr>
              </th>
              <th scope="col">
                <abbr title="Points">PTS</abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {sampleTable.map((row, i) => (
              <tr
                key={row.club}
                className={
                  row.club === "Mauve FC" ? "mauve-standing" : undefined
                }
              >
                <td>{i + 1}</td>
                <th scope="row">
                  {row.club}
                  {row.club === "Mauve FC" && (
                    <span className="our-club-dot" aria-label="Our club" />
                  )}
                </th>
                <td>{row.played}</td>
                <td>
                  {row.difference > 0 ? "+" : ""}
                  {row.difference}
                </td>
                <td>{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="friendly-summary">
          <h3>
            Good games.
            <br />
            Great company.
          </h3>
          <p>
            Four sample friendlies, one club. Friendly seasons don’t have a
            league table.
          </p>
          <Link className="text-link" href="/results/">
            Revisit the summer <ArrowUpRight size={15} />
          </Link>
        </div>
      )}
      <div className="standings-form">
        <div>
          <span className="eyebrow">CLUB FORM</span>
          <div className="form-group">
            {completed.slice(-5).map((m) => (
              <FormBadge key={m.id} value={outcome(m)} />
            ))}
          </div>
        </div>
        <Link className="text-link" href="/stats/">
          Season stats <ArrowUpRight size={15} />
        </Link>
      </div>
      {seasonId === "fall-2026" && (
        <p className="standings-note">
          Illustrative snapshot · not live league data.
        </p>
      )}
    </article>
  );
}
