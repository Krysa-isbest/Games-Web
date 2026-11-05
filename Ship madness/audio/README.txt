SHIP MADNESS - YOUR OWN SOUNDS AND MUSIC
=========================================

1. Put sound effects in  audio/sfx/   and music in  audio/music/
   (.mp3, .ogg or .wav)
2. Write the file names into  audio/list.json , in the slot they belong to, for example:
     "cannon": ["Cannon 1.mp3", "Cannon 2.mp3"],
     "battle": ["Battle theme.mp3"]
   More than one file in a slot = a random one each time.
   An empty slot [] = the game's built-in sound (or no music).

SOUND EFFECT SLOTS
  shot ............ any gunshot (used when a gun has no slot of its own)
  shot_pistol, shot_revolver, shot_smg, shot_ak, shot_lmg, shot_shotgun, shot_sniper
  shot_..._quiet .. the same gun with a suppressor (e.g. shot_ak_quiet)
  empty ........... click of an empty gun        reload ... magazine in/out
  pump ............ shotgun pump
  cannon .......... deck gun firing (also the mortar, if it has no file of its own)
  cannon_autocannon, cannon_mortar, cannon_rockets, cannon_torpedo ... the other deck gun types
  c4 .............. C4 going off                 boom ..... any other explosion
  nuke ............ the nuke going off           jet ...... airstrike plane
  siren ........... nuke warning siren
  wood ............ bullet hitting the hull      crash .... ships colliding / running aground
  hammer .......... nailing a plank              knock .... one hammer blow (fixing single blocks)
  ratchet ......... the wrench on the engine     anchor ... anchor chain running out / in
  splash .......... something hitting the water
  crackle ......... fire on deck                 bounce ... grenade bouncing
  hit ............. hit marker (you hit someone) hurt ..... you take damage
  bite ............ shark bite
  pickup, coin, levelup, bell, horn ............ rewards and alerts
  crane ........... crane motor                  thunder .. lightning
  click, hover, whoosh ......................... menu sounds
  ambience ........ looping sea / wind sound (replaces the built-in waves)

MUSIC SLOTS
  menu .... main menu (its own volume slider: Settings -> Audio -> Main menu music)
  sail .... calm sailing
  battle .. an enemy ship is near, or a nuke is coming
  boss .... the Ferryman fight (campaign)
  The music volume is in Settings -> Audio.

The game must be opened through a web server (GitHub Pages, Live Server...) for the files to load.
