// Maps a live sports event from the content bar to specific
// Dreamstreams / VibezTV category paths so the popup tells the user
// exactly where to look (Zone → Team → Locals → US Sports).

export type LiveHintKind = 'zone' | 'team' | 'locals' | 'spectrum' | 'tip';

export type LiveHint = {
  kind: LiveHintKind;
  chip: string;        // short label rendered as a colored chip
  label: string;       // primary line ("MLB Teams → Dodgers")
  sublabel?: string;   // secondary line, optional
};

type LiveItem = {
  source: string;
  title?: string;
  subtitle?: string;
};

// ---------- League → Zone name ----------
const ZONE_NAME: Record<string, string> = {
  NFL: 'NFL Zone',
  NBA: 'NBA Zone',
  WNBA: 'WNBA Zone',
  NHL: 'NHL Zone',
  MLB: 'MLB Zone',
  MLS: 'Soccer Zone',
  EPL: 'Soccer Zone',
  UCL: 'Soccer Zone',
  NCAAF: 'College Football Zone',
  NCAAB: 'College Basketball Zone',
  F1: 'Racing Zone',
  NASCAR: 'Racing Zone',
  PGA: 'Golf Zone',
  UFC: 'PPV / Fight Night Zone',
};

const TEAMS_CATEGORY: Record<string, string> = {
  NFL: 'NFL Teams',
  NBA: 'NBA Teams',
  WNBA: 'WNBA Teams',
  NHL: 'NHL Teams',
  MLB: 'MLB Teams',
  MLS: 'Soccer Teams',
  EPL: 'Soccer Teams',
  UCL: 'Soccer Teams',
  NCAAF: 'College Football Teams',
  NCAAB: 'College Basketball Teams',
};

// Leagues that get a "Locals" suggestion (US-based)
const US_LEAGUES = new Set(['NFL', 'NBA', 'WNBA', 'NHL', 'MLB', 'MLS', 'NCAAF', 'NCAAB']);

// Only Dodgers and Lakers air on Spectrum SportsNet — flag both for the
// "US Sports → Spectrum" suggestion.
const SPECTRUM_TEAMS = new Set(['Dodgers', 'Lakers']);

// ---------- Team → Home City ----------
// Keyed by the short / nickname ESPN returns ("Dodgers", "49ers", "Trail Blazers").
const TEAM_TO_CITY: Record<string, string> = {
  // MLB
  Diamondbacks: 'Phoenix', Braves: 'Atlanta', Orioles: 'Baltimore', 'Red Sox': 'Boston',
  Cubs: 'Chicago', 'White Sox': 'Chicago', Reds: 'Cincinnati', Guardians: 'Cleveland',
  Rockies: 'Denver', Tigers: 'Detroit', Astros: 'Houston', Royals: 'Kansas City',
  Angels: 'Los Angeles', Dodgers: 'Los Angeles', Marlins: 'Miami', Brewers: 'Milwaukee',
  Twins: 'Minneapolis', Mets: 'New York', Yankees: 'New York', Athletics: 'Oakland',
  Phillies: 'Philadelphia', Pirates: 'Pittsburgh', Padres: 'San Diego', Giants: 'San Francisco',
  Mariners: 'Seattle', Cardinals: 'St. Louis', Rays: 'Tampa', Rangers: 'Dallas',
  'Blue Jays': 'Toronto', Nationals: 'Washington',

  // NFL
  Cardinals_NFL: 'Phoenix', Falcons: 'Atlanta', Ravens: 'Baltimore', Bills: 'Buffalo',
  Panthers: 'Charlotte', Bears: 'Chicago', Bengals: 'Cincinnati', Browns: 'Cleveland',
  Cowboys: 'Dallas', Broncos: 'Denver', Lions: 'Detroit', Packers: 'Green Bay',
  Texans: 'Houston', Colts: 'Indianapolis', Jaguars: 'Jacksonville', Chiefs: 'Kansas City',
  Raiders: 'Las Vegas', Chargers: 'Los Angeles', Rams: 'Los Angeles', Dolphins: 'Miami',
  Vikings: 'Minneapolis', Patriots: 'Boston', Saints: 'New Orleans', Giants_NFL: 'New York',
  Jets: 'New York', Eagles: 'Philadelphia', Steelers: 'Pittsburgh', '49ers': 'San Francisco',
  Seahawks: 'Seattle', Buccaneers: 'Tampa', Titans: 'Nashville', Commanders: 'Washington',

  // NBA
  Hawks: 'Atlanta', Celtics: 'Boston', Nets: 'New York', Hornets: 'Charlotte',
  Cavaliers: 'Cleveland', Mavericks: 'Dallas', Nuggets: 'Denver', Pistons: 'Detroit',
  Warriors: 'San Francisco', Rockets: 'Houston', Pacers: 'Indianapolis', Clippers: 'Los Angeles',
  Lakers: 'Los Angeles', Grizzlies: 'Memphis', Heat: 'Miami', Bucks: 'Milwaukee',
  Timberwolves: 'Minneapolis', Pelicans: 'New Orleans', Knicks: 'New York', Thunder: 'Oklahoma City',
  Magic: 'Orlando', '76ers': 'Philadelphia', Suns: 'Phoenix', 'Trail Blazers': 'Portland',
  Kings: 'Sacramento', Spurs: 'San Antonio', Raptors: 'Toronto', Jazz: 'Salt Lake City',
  Wizards: 'Washington',

  // NHL
  Ducks: 'Anaheim', Coyotes: 'Phoenix', Bruins: 'Boston', Sabres: 'Buffalo',
  Flames: 'Calgary', Hurricanes: 'Raleigh', Blackhawks: 'Chicago', Avalanche: 'Denver',
  'Blue Jackets': 'Columbus', Stars: 'Dallas', 'Red Wings': 'Detroit', Oilers: 'Edmonton',
  Panthers_NHL: 'Miami', Kings_NHL: 'Los Angeles', Wild: 'Minneapolis', Canadiens: 'Montreal',
  Predators: 'Nashville', Devils: 'Newark', Islanders: 'New York', Senators: 'Ottawa',
  Flyers: 'Philadelphia', Penguins: 'Pittsburgh', Sharks: 'San Jose', Kraken: 'Seattle',
  'Maple Leafs': 'Toronto', Canucks: 'Vancouver', 'Golden Knights': 'Las Vegas',
  Capitals: 'Washington', Jets_NHL: 'Winnipeg',

  // WNBA
  Aces: 'Las Vegas', Liberty: 'New York', Sky: 'Chicago', Sun: 'Connecticut',
  Fever: 'Indianapolis', Lynx: 'Minneapolis', Mercury: 'Phoenix', Mystics: 'Washington',
  Sparks: 'Los Angeles', Storm: 'Seattle', Dream: 'Atlanta', Wings: 'Dallas',
};

// Build a case-insensitive lookup that ignores _NFL / _NHL disambiguation suffixes
const cityLookup = new Map<string, string>();
for (const [k, v] of Object.entries(TEAM_TO_CITY)) {
  const clean = k.replace(/_(NFL|NHL|NBA|MLB)$/i, '').toLowerCase();
  if (!cityLookup.has(clean)) cityLookup.set(clean, v);
}
const cityFor = (team: string): string | undefined => cityLookup.get(team.trim().toLowerCase());

// ---------- Parse the MediaItem ----------
const parseLeague = (subtitle?: string): string | undefined => {
  if (!subtitle) return undefined;
  return subtitle.split('·')[0]?.trim()?.toUpperCase();
};

const parseTeams = (title?: string): string[] => {
  if (!title) return [];
  // ESPN format: "Lakers @ Warriors" — also handle "vs"
  const parts = title.split(/\s+(?:@|vs\.?)\s+/i).map((s) => s.trim()).filter(Boolean);
  return parts.length === 2 ? parts : [];
};

// ---------- Public API ----------
export function getLiveHints(item: LiveItem | null | undefined): LiveHint[] {
  if (!item || item.source !== 'sports') return [];
  const league = parseLeague(item.subtitle);
  const teams = parseTeams(item.title);
  const hints: LiveHint[] = [];

  // 1) Zone
  if (league && ZONE_NAME[league]) {
    hints.push({ kind: 'zone', chip: 'Zone', label: ZONE_NAME[league] });
  }

  // 2) Per-team rows
  if (league && TEAMS_CATEGORY[league]) {
    for (const team of teams) {
      hints.push({
        kind: 'team',
        chip: 'Team',
        label: `${TEAMS_CATEGORY[league]} → ${team}`,
      });
    }
  }

  // 3) Spectrum (Dodgers / Lakers only)
  for (const team of teams) {
    if (SPECTRUM_TEAMS.has(team)) {
      hints.push({
        kind: 'spectrum',
        chip: 'Spectrum',
        label: 'US Sports → Spectrum SportsNet',
        sublabel: `${team} home broadcasts`,
      });
    }
  }

  // 4) Locals (US leagues only)
  if (league && US_LEAGUES.has(league)) {
    const seenCities = new Set<string>();
    for (const team of teams) {
      const city = cityFor(team);
      if (city && !seenCities.has(city)) {
        seenCities.add(city);
        hints.push({ kind: 'locals', chip: 'Locals', label: `${city} Locals` });
      }
    }
  }

  // 5) Generic tip about national broadcasts (only when there's a league)
  if (league && (US_LEAGUES.has(league) || league === 'UFC')) {
    hints.push({
      kind: 'tip',
      chip: 'Tip',
      label: 'Also try US Sports if the game is on ESPN, Fox Sports, TNT, or ABC.',
    });
  }

  return hints;
}
