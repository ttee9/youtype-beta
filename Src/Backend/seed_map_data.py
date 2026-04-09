"""
Seed script: inserts geo-tagged sample posts for map testing.
Run from Src/Backend/:  python seed_map_data.py
Requires DATABASE_URL in .env or environment.
"""
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Allow importing the app package
sys.path.insert(0, str(Path(__file__).parent))

from app.db import init_db, insert_post

POSTS = [
    # US – East Coast
    {"text": "Rent in New York City has gone up 30% in the last two years. I can barely afford my studio anymore.", "location": "New York, NY", "lat": 40.7128, "lng": -74.0060},
    {"text": "Boston housing market is insane. Competing with 20 other offers just to rent a one-bedroom.", "location": "Boston, MA", "lat": 42.3601, "lng": -71.0589},
    {"text": "Miami rents keep climbing even though wages haven't budged. Something has to give.", "location": "Miami, FL", "lat": 25.7617, "lng": -80.1918},
    {"text": "DC cost of living is crushing people who aren't lobbyists or government contractors.", "location": "Washington, DC", "lat": 38.9072, "lng": -77.0369},
    {"text": "Philadelphia is supposed to be the affordable city but not anymore. Prices are ridiculous.", "location": "Philadelphia, PA", "lat": 39.9526, "lng": -75.1652},

    # US – Midwest
    {"text": "Even Chicago rents are getting out of hand. Used to be you could find something decent for $900.", "location": "Chicago, IL", "lat": 41.8781, "lng": -87.6298},
    {"text": "Minneapolis housing crisis is real. Inventory is low and landlords know it.", "location": "Minneapolis, MN", "lat": 44.9778, "lng": -93.2650},
    {"text": "Detroit is supposed to be affordable but gentrification is pricing out longtime residents.", "location": "Detroit, MI", "lat": 42.3314, "lng": -83.0458},

    # US – West Coast
    {"text": "San Francisco rents are still astronomical. A closet-sized room costs more than a mortgage elsewhere.", "location": "San Francisco, CA", "lat": 37.7749, "lng": -122.4194},
    {"text": "Los Angeles housing is broken. Working two jobs and still can't save for a deposit.", "location": "Los Angeles, CA", "lat": 34.0522, "lng": -118.2437},
    {"text": "Seattle rent went up $400 this year. My landlord said it's the market. What market?", "location": "Seattle, WA", "lat": 47.6062, "lng": -122.3321},
    {"text": "Portland feels different now. All the affordable neighborhoods are unrecognizable.", "location": "Portland, OR", "lat": 45.5051, "lng": -122.6750},

    # US – South / Southwest
    {"text": "Austin used to be cheap. Now it costs more than most major cities and salaries haven't caught up.", "location": "Austin, TX", "lat": 30.2672, "lng": -97.7431},
    {"text": "Nashville is exploding with new residents and rents reflect that. Local workers are struggling.", "location": "Nashville, TN", "lat": 36.1627, "lng": -86.7816},
    {"text": "Phoenix housing costs tripled in five years. People I know are moving back in with family.", "location": "Phoenix, AZ", "lat": 33.4484, "lng": -112.0740},
    {"text": "Denver used to be the affordable mountain city. Those days are gone.", "location": "Denver, CO", "lat": 39.7392, "lng": -104.9903},

    # International
    {"text": "London rents are at record highs. Sharing with four people in my 30s wasn't the plan.", "location": "London, UK", "lat": 51.5074, "lng": -0.1278},
    {"text": "Toronto housing market makes no sense. Entry-level condos cost a million dollars.", "location": "Toronto, Canada", "lat": 43.6532, "lng": -79.3832},
    {"text": "Sydney apartment prices have completely disconnected from average incomes.", "location": "Sydney, Australia", "lat": -33.8688, "lng": 151.2093},
    {"text": "Berlin used to be the affordable European capital. Rents have doubled since 2015.", "location": "Berlin, Germany", "lat": 52.5200, "lng": 13.4050},
    {"text": "Amsterdam is no longer livable for people who aren't in tech or finance.", "location": "Amsterdam, Netherlands", "lat": 52.3676, "lng": 4.9041},
    {"text": "Tokyo rents are actually reasonable compared to other global cities, but wages are stagnant.", "location": "Tokyo, Japan", "lat": 35.6762, "lng": 139.6503},
    {"text": "Vancouver has some of the worst housing affordability in the world relative to income.", "location": "Vancouver, Canada", "lat": 49.2827, "lng": -123.1207},
    {"text": "Dublin rents rose 60% in a decade. Young people are emigrating again.", "location": "Dublin, Ireland", "lat": 53.3498, "lng": -6.2603},
]

def main():
    print("Initializing database...")
    init_db()

    now = datetime.now(timezone.utc)
    inserted = 0

    for i, p in enumerate(POSTS):
        # Spread posts over the last 30 days
        offset_hours = int((i / len(POSTS)) * 30 * 24)
        created_at = (now - timedelta(hours=offset_hours)).isoformat()

        record = {
            "id": str(uuid.uuid4()),
            "text": p["text"],
            "location": p["location"],
            "latitude": p["lat"],
            "longitude": p["lng"],
            "created_at": created_at,
            "embedding": None,
        }
        insert_post(post=record)
        inserted += 1
        print(f"  [{inserted:>2}/{len(POSTS)}] {p['location']}")

    print(f"\nDone. Inserted {inserted} geo-tagged posts.")

if __name__ == "__main__":
    main()
