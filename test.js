const express = require('express');
const axios = require('axios');

const app = express();
const PORT = 3000;

// --- Configuration de l'API ---
const apiKey = '7f7700a471beeeb52aecde406a3870ba';
const api = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  headers: {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': 'v3.football.api-sports.io',
  },
});

// ID et saison pour les Qualifications de la Coupe du Monde - Europe
const LEAGUE_ID = 32;
const SEASON = 2024;

/**
 * La fonction principale qui récupère et agrège TOUTES les données.
 */
const getFullMatchAnalysis = async () => {
  try {
    // --- 1. Trouver le prochain match disponible ---
    console.log(`\n🔍 Recherche du prochain match des Qualifications Coupe du Monde (Europe, saison ${SEASON})...`);
    const fixturesResponse = await api.get('/fixtures', {
      params: { league: LEAGUE_ID, season: SEASON, status: 'NS' }
    });
    const nextFixtures = fixturesResponse.data.response.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
    if (nextFixtures.length === 0) throw new Error(`Aucun match à venir trouvé.`);
    
    const fixture = nextFixtures[0];
    const fixtureId = fixture.fixture.id;
    const homeTeamId = fixture.teams.home.id;
    const awayTeamId = fixture.teams.away.id;
    
    console.log(`✅ Match trouvé : ${fixture.teams.home.name} vs ${fixture.teams.away.name} (ID: ${fixtureId})`);
    console.log("🚀 Lancement de la récupération massive de données...");

    // --- 2. Lancer tous les appels API en parallèle (anciens et nouveaux) ---
    const [
      predictionData,
      homeTeamStats,
      awayTeamStats,
      lineupsData,
      injuriesData,
      // NOUVEAUX APPELS POUR LA FORME ACTUELLE
      homeTeamLast10, 
      awayTeamLast10,
      headToHeadData
    ] = await Promise.all([
      api.get('/predictions', { params: { fixture: fixtureId } }),
      api.get('/teams/statistics', { params: { league: LEAGUE_ID, season: SEASON, team: homeTeamId } }),
      api.get('/teams/statistics', { params: { league: LEAGUE_ID, season: SEASON, team: awayTeamId } }),
      api.get('/fixtures/lineups', { params: { fixture: fixtureId } }),
      api.get('/injuries', { params: { fixture: fixtureId } }),
      // Récupère les 10 derniers matchs de l'équipe à domicile (toutes compétitions)
      api.get('/fixtures', { params: { team: homeTeamId, last: 10 } }),
      // Récupère les 10 derniers matchs de l'équipe à l'extérieur (toutes compétitions)
      api.get('/fixtures', { params: { team: awayTeamId, last: 10 } }),
      // Récupère les confrontations directes (H2H)
      api.get('/fixtures/headtohead', { params: { h2h: `${homeTeamId}-${awayTeamId}` } })
    ]);
    
    console.log("✅ Toutes les données ont été récupérées !");

    // --- 3. Agréger toutes les données brutes ---
    const fullAnalysis = {
      matchDetails: fixture,
      prediction: predictionData.data.response[0] || 'Pas de données de prédiction disponibles.',
      // NOUVELLES DONNÉES DE FORME
      currentForm: {
        home_last_10_matches: homeTeamLast10.data.response,
        away_last_10_matches: awayTeamLast10.data.response,
      },
      headToHead: headToHeadData.data.response,
      teamStats_in_this_competition: { // Renommé pour plus de clarté
        home: homeTeamStats.data.response,
        away: awayTeamStats.data.response,
      },
      lineups: lineupsData.data.response.length > 0 ? lineupsData.data.response : 'Compositions non disponibles.',
      injuriesAndSuspensions: injuriesData.data.response.length > 0 ? injuriesData.data.response : 'Aucun blessé ou suspendu.',
    };
    
    return fullAnalysis;

  } catch (error) {
    console.error("❌ Une erreur est survenue:", error.response?.data || error.message);
    return { error: "Impossible de récupérer les données.", details: error.response?.data || error.message };
  }
};

// --- Le reste du serveur est inchangé ---
app.get('/', (req, res) => res.send('<h1>Serveur de l\'Oracle</h1><p>Allez sur <a href="/analyse-match">/analyse-match</a></p>'));
app.get('/analyse-match', async (req, res) => {
  console.log("⚡ Requête reçue sur /analyse-match");
  const data = await getFullMatchAnalysis();
  res.json(data);
});
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré !`);
  console.log(`🌍 Accédez à l'analyse ici : http://localhost:${PORT}/analyse-match`);
});