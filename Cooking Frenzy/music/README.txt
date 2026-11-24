YOUR OWN MUSIC FOR COOKING FRENZY
=================================

1. Put your songs (MP3, OGG, M4A or WAV) into this "music" folder.
2. Write their exact file names into list.json, like this:

   [
     "My song.mp3",
     "Another song.mp3"
   ]

   (Each name in quotes, a comma between them, no comma after the last one.)

3. In the game: Settings -> Audio -> Music -> "My music".
   "My music volume" sets how loud your songs are, "Next song" skips one.

Songs play shuffled, one after another, in the menu and during the shift.

On your PC with VS Code's Live Server the game can read this folder by itself,
so there list.json is optional. On the website (GitHub Pages) the game only
knows the songs that are in list.json, so upload the songs AND list.json.
