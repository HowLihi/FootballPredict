import json
from collections import Counter
import os

json_path = '/tmp/worldcup2026.json'

with open(json_path) as f:
    data = json.load(f)

GROUND_MAP = {
    'Mexico City': 'Estadio Azteca (Mexico City)',
    'Guadalajara (Zapopan)': 'Estadio Akron (Guadalajara)',
    'Monterrey (Guadalupe)': 'Estadio BBVA (Monterrey)',
    'Toronto': 'BMO Field (Toronto)',
    'Vancouver': 'BC Place (Vancouver)',
    'Los Angeles (Inglewood)': 'SoFi Stadium (Los Angeles)',
    'Dallas (Arlington)': 'AT&T Stadium (Dallas)',
    'New York/New Jersey (East Rutherford)': 'MetLife Stadium (New York)',
    'Miami (Miami Gardens)': 'Hard Rock Stadium (Miami)',
    'Atlanta': 'Mercedes-Benz Stadium (Atlanta)',
    'Boston (Foxborough)': 'Gillette Stadium (Boston)',
    'Houston': 'NRG Stadium (Houston)',
    'Kansas City': 'Arrowhead Stadium (Kansas City)',
    'Philadelphia': 'Lincoln Financial Field (Philadelphia)',
    'San Francisco Bay Area (Santa Clara)': "Levi's Stadium (Santa Clara)",
    'Seattle': 'Lumen Field (Seattle)',
}

US_GROUNDS = {
    'Los Angeles (Inglewood)', 'Seattle', 'Dallas (Arlington)',
    'Atlanta', 'Boston (Foxborough)', 'Houston', 'Kansas City',
    'Philadelphia', 'San Francisco Bay Area (Santa Clara)',
    'New York/New Jersey (East Rutherford)', 'Miami (Miami Gardens)',
}

ROUND_MAP = {
    'Round of 32': 4, 'Round of 16': 5, 'Quarter-final': 6,
    'Semi-final': 7, 'Match for third place': 8, 'Final': 8,
}

def is_valid_team(name):
    return name and not name[0].isdigit() and not name.startswith(('W', 'L'))

team_round = {}
rows = []

for m in data['matches']:
    g = m.get('group', '')
    round_label = m.get('round', '')
    team1 = m.get('team1', '')
    team2 = m.get('team2', '')
    ground = m.get('ground', '')
    time_str = m.get('time', '')

    if 'Group' in g:
        group_name = g.replace('Group ', '')
        r1 = team_round.get((group_name, team1), 0)
        r2 = team_round.get((group_name, team2), 0)
        round_num = max(r1, r2) + 1
        if is_valid_team(team1):
            team_round[(group_name, team1)] = round_num
        if is_valid_team(team2):
            team_round[(group_name, team2)] = round_num
    else:
        round_num = ROUND_MAP.get(round_label, 0)
        group_name = ''

    if 'UTC' in time_str:
        time_part = time_str.split(' UTC')[0]
        parts = time_part.split(':')
        match_time = f"{parts[0]}:{parts[1]}:00" if len(parts) == 2 else time_part
    else:
        match_time = '15:00:00'

    venue = GROUND_MAP.get(ground, ground)

    is_neutral = 'true'
    if team1 == 'Mexico' and 'Mexico' in ground:
        is_neutral = 'false'
    elif team1 == 'Canada' and ('Toronto' in ground or 'Vancouver' in ground):
        is_neutral = 'false'
    elif team1 == 'USA' and ground in US_GROUNDS:
        is_neutral = 'false'

    score = m.get('score')
    home_score = ''
    away_score = ''
    if score and isinstance(score, dict) and 'ft' in score:
        ft = score['ft']
        if isinstance(ft, list) and len(ft) >= 2:
            home_score = str(ft[0])
            away_score = str(ft[1])

    rows.append({
        'date': m['date'],
        'group': group_name,
        'home_team': team1,
        'away_team': team2,
        'round': round_num,
        'venue': venue,
        'neutral': is_neutral,
        'match_time': match_time,
        'home_score': home_score,
        'away_score': away_score,
    })

csv_path = os.path.join(
    os.path.dirname(__file__), '..', 'data', 'csv', 'world_cup_2026_fixtures.csv'
)
csv_path = os.path.abspath(csv_path)
os.makedirs(os.path.dirname(csv_path), exist_ok=True)

with open(csv_path, 'w', newline='') as f:
    f.write('date,group,home_team,away_team,round,venue,neutral,match_time,home_score,away_score\n')
    for r in rows:
        f.write(f"{r['date']},{r['group']},{r['home_team']},{r['away_team']},{r['round']},{r['venue']},{r['neutral']},{r['match_time']},{r['home_score']},{r['away_score']}\n")

print(f"Written {len(rows)} rows to {csv_path}")

# Verify Brazil vs Morocco
for r in rows:
    if 'Brazil' in (r['home_team'], r['away_team']) and 'Morocco' in (r['home_team'], r['away_team']):
        h = int(r['match_time'].split(':')[0])
        print(f"\nBrazil vs Morocco: {r['date']} {r['match_time']} | {r['venue']}")
        print(f"  Venue local: {r['match_time']} (MetLife = UTC-4)")
        print(f"  Beijing: {r['date'][:8]}{(h + 12) % 24:02d}:{r['match_time'][3:]} (next day)")
        print(f"  Expected: Beijing 06:00 June 14 → {(h + 12) % 24 == 6}")

# Round distribution
rc = Counter(r['round'] for r in rows)
print("\nRound distribution:")
for k, v in sorted(rc.items()):
    print(f"  Round {k}: {v} matches")

# Show first few group matches
print("\nFirst 6 matches:")
for r in rows[:6]:
    print(f"  {r['date']} {r['match_time']} | {r['group']} | R{r['round']} | {r['home_team']} vs {r['away_team']} | {r['venue']}")