import { Button } from "../../design/components";
import { editionID, type EditionFollow } from "../../data/following";
import { settings, useSettings } from "../../state/settings";
export function EditionFollowButton({edition}: {edition: EditionFollow}) {
  const on = useSettings(s => s.editions.some(e => editionID(e) === editionID(edition)));
  return <Button aria-pressed={on} onClick={() => settings.toggleEdition(edition)} title="This edition only · Alerts off">{on ? "Following edition" : "Follow edition"}</Button>;
}
