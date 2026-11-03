Music for Chucky's House (mp3 or ogg, ~2-5 MB per track, never over 100 MB: GitHub's limit).

1. Put the file in this folder, e.g. "main menu.mp3".
2. Add its name to the right list in list.json, e.g.  "menu": ["main menu.mp3"]
   (the name must match exactly, upper/lower case too: GitHub cares)

Lists: menu (main menu), intro (car radio in the opening drive), shop (radio: Chill FM),
evening (radio: Night Jazz), krysy (radio: Krysy o'clock), auction (the Saturday auction), night (expeditions),
chase (extra layer when an enemy chases you), down (bleeding out), prison (game over).
Several files in one list = they play in random order.

An empty list is not silence: the game synthesizes its own track for evening, auction, krysy,
night, down and prison (and a soft car-radio pad for the intro). A file in the list
always replaces the synthesized one. The win ending track is always synthesized.
