const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Cache simples em memória
let twitchToken = null; // { access_token, expires_at }

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

function readJsonFileSafe(filePath, fallback) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data;
  } catch (e) {
    return fallback;
  }
}

function loadStreamers() {
  const filePath = path.join(__dirname, '../database/streamers.json');
  const defaults = {
    twitchUsernames: [
      'fs_kawan',
      'sheepking_aoe'
    ],
    youtubeChannelIds: [
      // Coloque aqui os channelIds do YouTube (ex.: UCxxxxxxxxxxxx)
    ]
  };
  const cfg = readJsonFileSafe(filePath, defaults);
  const twitchUsernames = Array.isArray(cfg.twitchUsernames) ? cfg.twitchUsernames : [];
  const youtubeChannelIds = Array.isArray(cfg.youtubeChannelIds) ? cfg.youtubeChannelIds : [];
  return { twitchUsernames, youtubeChannelIds };
}

async function getTwitchAccessToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  if (twitchToken && twitchToken.expires_at > nowEpoch() + 60) {
    return twitchToken.access_token;
  }

  const url = 'https://id.twitch.tv/oauth2/token';
  const params = {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  };
  const resp = await axios.post(url, null, { params, timeout: 10000 });
  const data = resp.data || {};
  twitchToken = {
    access_token: data.access_token,
    expires_at: nowEpoch() + (Number(data.expires_in) || 3600),
  };
  return twitchToken.access_token;
}

async function fetchTwitchStreamsByUsernames(usernames) {
  if (!Array.isArray(usernames) || usernames.length === 0) return [];
  const accessToken = await getTwitchAccessToken();
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!accessToken || !clientId) {
    // Fallback sem credenciais: usar decapi.me para checar status
    const fallback = await Promise.all(
      usernames.map(async (login) => {
        try {
          const url = `https://decapi.me/twitch/status/${encodeURIComponent(login)}`;
          const resp = await axios.get(url, { timeout: 8000 });
          const text = String(resp.data || '').toLowerCase();
          const isLive = text.includes('is live') || text.includes('currently live');
          if (!isLive) return null;
          const titleMatch = String(resp.data || '').match(/is live: (.*)$/i);
          const title = titleMatch ? titleMatch[1] : 'Live on Twitch';
          return {
            id: `${login}-decapi`,
            username: login,
            title,
            game: 'Twitch',
            viewerCount: 0,
            thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-320x180.jpg`,
            url: `https://twitch.tv/${login}`,
            platform: 'twitch',
          };
        } catch (_) {
          return null;
        }
      })
    );
    return fallback.filter(Boolean);
  }

  // Twitch permite até 100 user_login por request
  const chunkSize = 100;
  const chunks = [];
  for (let i = 0; i < usernames.length; i += chunkSize) {
    chunks.push(usernames.slice(i, i + chunkSize));
  }

  const results = [];
  for (const chunk of chunks) {
    const params = new URLSearchParams();
    chunk.forEach((login) => params.append('user_login', login));
    const url = `https://api.twitch.tv/helix/streams?${params.toString()}`;
    const resp = await axios.get(url, {
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${accessToken}`,
      },
      timeout: 10000,
    });
    const data = Array.isArray(resp.data?.data) ? resp.data.data : [];
    data.forEach((s) => {
      const thumb = (s.thumbnail_url || '').replace('{width}', '320').replace('{height}', '180');
      results.push({
        id: s.id,
        username: s.user_login || s.user_name,
        title: s.title || '',
        game: s.game_name || '',
        viewerCount: s.viewer_count || 0,
        thumbnail: thumb,
        url: `https://twitch.tv/${s.user_login || s.user_name}`,
        platform: 'twitch',
      });
    });
  }
  return results;
}

async function fetchYouTubeLiveByChannels(channelIds) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || !Array.isArray(channelIds) || channelIds.length === 0) return [];

  const results = [];
  for (const channelId of channelIds) {
    try {
      // Buscar vídeos atuais "live" do canal
      const searchUrl = 'https://www.googleapis.com/youtube/v3/search';
      const searchParams = {
        key: apiKey,
        part: 'snippet',
        channelId,
        eventType: 'live',
        type: 'video',
        maxResults: 5,
      };
      const searchResp = await axios.get(searchUrl, { params: searchParams, timeout: 10000 });
      const items = Array.isArray(searchResp.data?.items) ? searchResp.data.items : [];
      if (items.length === 0) continue;

      // Pegar detalhes para viewer count
      const videoIds = items.map((it) => it.id?.videoId).filter(Boolean);
      if (videoIds.length === 0) continue;
      const videosUrl = 'https://www.googleapis.com/youtube/v3/videos';
      const videosParams = {
        key: apiKey,
        part: 'liveStreamingDetails,snippet',
        id: videoIds.join(','),
      };
      const videosResp = await axios.get(videosUrl, { params: videosParams, timeout: 10000 });
      const videos = Array.isArray(videosResp.data?.items) ? videosResp.data.items : [];

      videos.forEach((v) => {
        const concurrent = Number(v.liveStreamingDetails?.concurrentViewers || 0);
        const title = v.snippet?.title || '';
        const channelTitle = v.snippet?.channelTitle || '';
        const videoId = v.id;
        results.push({
          id: videoId,
          username: channelTitle,
          title,
          game: 'Age of Empires II: Definitive Edition',
          viewerCount: concurrent,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          platform: 'youtube',
        });
      });
    } catch (_) {
      // Ignorar erro por canal
    }
  }

  return results;
}

async function getTwitchStreams() {
  const { twitchUsernames } = loadStreamers();
  try {
    return await fetchTwitchStreamsByUsernames(twitchUsernames);
  } catch (e) {
    return [];
  }
}

async function getYouTubeStreams() {
  const { youtubeChannelIds } = loadStreamers();
  try {
    return await fetchYouTubeLiveByChannels(youtubeChannelIds);
  } catch (e) {
    return [];
  }
}

async function getAllStreams() {
  const [twitch, youtube] = await Promise.all([
    getTwitchStreams(),
    getYouTubeStreams(),
  ]);
  return [...twitch, ...youtube];
}

module.exports = {
  getTwitchStreams,
  getYouTubeStreams,
  getAllStreams,
};


