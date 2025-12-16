import { query } from './_lib/db.js';
import { handleCors } from './_lib/cors.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all species with their conversions
    const speciesResult = await query(`
      SELECT 
        s.id,
        s.name,
        s.scientific_name,
        s.category
      FROM species s
      ORDER BY s.category, s.name
    `);

    // Get all yield conversions
    const yieldsResult = await query(`
      SELECT 
        fy.species_id,
        fy.from_state,
        fy.to_state,
        fy.yield_percent,
        fy.range_min,
        fy.range_max
      FROM fish_yields fy
      ORDER BY fy.species_id, fy.from_state, fy.to_state
    `);

    // Get all profiles
    const profilesResult = await query(`
      SELECT 
        sp.species_id,
        sp.description,
        sp.culinary_uses,
        sp.edible_portions,
        sp.url
      FROM species_profiles sp
    `);

    // Build the response in the format the Calculator expects
    const fishData = {};
    const profiles = {};

    // Create species map
    const speciesMap = {};
    for (const species of speciesResult.rows) {
      speciesMap[species.id] = species;
      fishData[species.name] = {
        scientific_name: species.scientific_name,
        category: species.category,
        conversions: {}
      };
    }

    // Add conversions
    for (const yieldRow of yieldsResult.rows) {
      const species = speciesMap[yieldRow.species_id];
      if (species && fishData[species.name]) {
        const fromLabel = yieldRow.from_state !== "Round" && 
                          yieldRow.from_state !== "Whole" && 
                          yieldRow.from_state !== "Raw Whole" 
                          ? `From ${yieldRow.from_state}: ` : "";
        const label = `${fromLabel}${yieldRow.to_state}`;
        
        fishData[species.name].conversions[label] = {
          yield: String(yieldRow.yield_percent),
          range: yieldRow.range_min && yieldRow.range_max 
                 ? `${yieldRow.range_min}-${yieldRow.range_max}` 
                 : null,
          from: yieldRow.from_state,
          to: yieldRow.to_state
        };
      }
    }

    // Add profiles
    for (const profile of profilesResult.rows) {
      const species = speciesMap[profile.species_id];
      if (species) {
        profiles[species.name] = {
          description: profile.description,
          culinary_uses: profile.culinary_uses,
          edible_portions: profile.edible_portions,
          url: profile.url
        };
      }
    }

    return res.status(200).json({
      fishData,
      profiles,
      source: {
        title: "Recoveries and Yields from Pacific Fish and Shellfish",
        authors: ["Chuck Crapo", "Brian Paust", "Jerry Babbitt"],
        publisher: "Alaska Sea Grant College Program",
        publication: "Marine Advisory Bulletin No. 37",
        year: 2004
      }
    });

  } catch (err) {
    console.error('Error fetching fish data:', err);
    return res.status(500).json({ error: 'Failed to fetch fish data' });
  }
}

export default handleCors(handler);
