"use client";
import type { Player } from "@/lib/types";
import { preferredPositions } from "@/lib/types";

export function withEditableDetails(player: Player): Player {
  return {
    ...player,
    preferredPositions: player.preferredPositions || [],
    captainDetails: player.captainDetails || {
      email: "",
      phone: "",
      relationshipNote: "",
      revision: 0,
    },
  };
}

export function PlayerDetailFields({
  player,
  onChange,
}: {
  player: Player;
  onChange: (player: Player) => void;
}) {
  const details = withEditableDetails(player).captainDetails!;
  return (
    <div className="player-detail-fields">
      <fieldset className="preferred-position-fields">
        <legend>Preferred playing positions · optional</legend>
        <p>
          Select every position this player likes playing. These preferences are
          visible to the team.
        </p>
        <div className="position-checkboxes">
          {preferredPositions.map((position) => (
            <label key={position}>
              <input
                type="checkbox"
                checked={player.preferredPositions?.includes(position) || false}
                onChange={(e) =>
                  onChange({
                    ...player,
                    preferredPositions: e.target.checked
                      ? [...(player.preferredPositions || []), position]
                      : (player.preferredPositions || []).filter(
                          (p) => p !== position,
                        ),
                  })
                }
              />
              <span>{position}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="captain-contact-fields">
        <legend>Captain’s notebook</legend>
        <p>
          Contact details and notes are visible only to captains, including for
          public profiles.
        </p>
        <div className="field-pair">
          <label className="form-field">
            <span>Contact email · optional</span>
            <input
              type="email"
              autoComplete="off"
              maxLength={254}
              value={details.email}
              onChange={(e) =>
                onChange({
                  ...player,
                  captainDetails: { ...details, email: e.target.value },
                })
              }
            />
          </label>
          <label className="form-field">
            <span>Phone number · optional</span>
            <input
              type="tel"
              autoComplete="off"
              maxLength={50}
              value={details.phone}
              onChange={(e) =>
                onChange({
                  ...player,
                  captainDetails: { ...details, phone: e.target.value },
                })
              }
            />
          </label>
        </div>
        <label className="form-field">
          <span>How we know this player · optional</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={details.relationshipNote}
            placeholder="Met through a teammate, played together in a previous season…"
            onChange={(e) =>
              onChange({
                ...player,
                captainDetails: {
                  ...details,
                  relationshipNote: e.target.value,
                },
              })
            }
          />
        </label>
        <p className="help-text">
          An invitation saves its email here automatically. Changing this
          contact email does not change the player’s sign-in email.
        </p>
      </fieldset>
    </div>
  );
}
