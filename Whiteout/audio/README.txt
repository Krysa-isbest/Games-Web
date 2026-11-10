WHITEOUT - YOUR OWN MUSIC

1. Put the song in audio/music/
2. Write its name into audio/list.json:
     "menu":  ["Main menu.mp3"]       the main menu song
     "intro": ["Intro.mp3"]           the opening cutscene song (90 seconds)
   Several songs = a random one each time.
   No menu song = the menu plays a quiet cold drone under the wind instead.
   No intro song = the cutscene plays its own synthesized score.
3. Volume: Settings > Audio > Main menu music (the menu song) and In-game music (the intro song).

The intro song starts the moment the cutscene starts. Its big moments (all in seconds):
   0      fade in, the calm flight
   23.5   the seatbelt chime, the captain speaks (keep it quiet here)
   28.2   the power cut: the lights die
   30     the alarm, turbulence building up
   40     the crash: the screen goes black (best: silence until about 50)
   50     waking up in the burning plane
   66.5   the radio comes alive (keep it quiet: voices on the radio)
   85.5   the radio dies
   86.5   "Get out of the plane", the fire spreads
   90     the end

The game must be opened through a web server (GitHub Pages, Live Server...) for the file to load.
