import { positionGroups, type Player, type PositionGroup } from "@/lib/types";

export function PositionGroupFields({
  player,
  onChange,
}: {
  player: Player;
  onChange: (player: Player) => void;
}) {
  return (
    <div className="field-pair">
      <label className="form-field">
        <span>Primary position group</span>
        <select
          value={player.position}
          onChange={(e) => {
            const position = e.target.value as PositionGroup;
            onChange({
              ...player,
              position,
              secondaryPosition:
                position === player.secondaryPosition
                  ? null
                  : player.secondaryPosition,
            });
          }}
        >
          {positionGroups.map((position) => (
            <option key={position}>{position}</option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>Second position group · optional</span>
        <select
          value={player.secondaryPosition ?? ""}
          onChange={(e) => {
            onChange({
              ...player,
              secondaryPosition: (e.target.value ||
                null) as PositionGroup | null,
            });
          }}
        >
          <option value="">None</option>
          {positionGroups
            .filter((position) => position !== player.position)
            .map((position) => (
              <option key={position}>{position}</option>
            ))}
        </select>
      </label>
    </div>
  );
}
