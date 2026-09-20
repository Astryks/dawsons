// Factual reference points only (song title / artist / year) — real
// songs people already know, used purely to show what each genre
// sounds like. Not chord charts, not transcriptions, not audio: the
// example songs linked from here are original Dawsons compositions in
// each style, not reconstructions of these tracks (see docs/UX_DESIGN.md
// in the repo for the full reasoning).
const GENRE_INSPIRATION = {
  Pop: [
    { title: "Love Story", artist: "Taylor Swift", year: 2008 },
    { title: "Last Christmas", artist: "Wham!", year: 1984 },
    { title: "Without You", artist: "Mariah Carey", year: 1994 },
    { title: "Beat It", artist: "Michael Jackson", year: 1983 },
    { title: "Rolling in the Deep", artist: "Adele", year: 2010 },
  ],
  Jazz: [
    { title: "My Funny Valentine", artist: "Chet Baker", year: 1954 },
    { title: "Almost Blue", artist: "Chet Baker (an Elvis Costello song)", year: 1987 },
    { title: "I'm a Fool to Want You", artist: "Chet Baker" },
    { title: "So What", artist: "Miles Davis", year: 1959 },
    { title: "My Favorite Things", artist: "John Coltrane", year: 1961 },
  ],
  "Hip-Hop": [
    { title: "Gin and Juice", artist: "Snoop Dogg", year: 1993 },
    { title: "Still D.R.E.", artist: "Dr. Dre ft. Snoop Dogg", year: 1999 },
    { title: "Nuthin' but a 'G' Thang", artist: "Dr. Dre ft. Snoop Dogg", year: 1992 },
    { title: "Lose Yourself", artist: "Eminem", year: 2002 },
    { title: "Without Me", artist: "Eminem", year: 2002 },
  ],
  Holiday: [
    { title: "Last Christmas", artist: "Wham!", year: 1984 },
    { title: "All I Want for Christmas Is You", artist: "Mariah Carey", year: 1994 },
    { title: "Rockin' Around the Christmas Tree", artist: "Brenda Lee", year: 1958 },
    { title: "White Christmas", artist: "Bing Crosby", year: 1942 },
  ],
};

// Video IDs verified against official artist/label channel uploads via
// web search before use — see STATUS.md for the verification notes,
// including the one candidate that turned out to have embedding
// disabled and was swapped for a different official upload.
const SPOTLIGHTS = [
  {
    genre: "Pop",
    title: "Love Story",
    artist: "Taylor Swift",
    youtubeId: "LHxXaY7NR3w",
    note: "A story-song built around a simple I–V–vi–IV-family progression under the vocal.",
    exampleSongTitle: "Morning Loop",
  },
  {
    genre: "Jazz",
    title: "My Funny Valentine",
    artist: "Chet Baker",
    youtubeId: "EGPRCu2kupE",
    note: "A 1954 jazz standard recording built on trumpet/vocal, piano, bass, and brushed drums.",
    exampleSongTitle: "Blue Corner",
  },
  {
    genre: "Hip-Hop",
    title: "Gin and Juice",
    artist: "Snoop Dogg",
    youtubeId: "fWCZse1iwE0",
    note: "Classic laid-back G-funk: whiny synth lead, deep bass, funky keys.",
    exampleSongTitle: "Corner Groove",
    explicit: true,
  },
  {
    genre: "Holiday",
    title: "Last Christmas",
    artist: "Wham!",
    youtubeId: "E8gmARGvPlI",
    note: "Warm holiday-pop with a sparkly synth hook over a simple major-key loop.",
    exampleSongTitle: "Fireside Loop",
  },
];

const GENRES = ["All", "Pop", "Jazz", "Hip-Hop", "Holiday"];
let selectedGenre = "All";

function renderTabs() {
  const el = document.getElementById("genre-tabs");
  el.innerHTML = GENRES.map(
    (g) => `<button data-genre="${g}" class="${g === selectedGenre ? "is-active" : ""}">${g}</button>`
  ).join("");
  el.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      selectedGenre = btn.dataset.genre;
      renderAll();
    };
  });
}

function renderInspiration() {
  const el = document.getElementById("inspiration-list");
  if (selectedGenre === "All" || !GENRE_INSPIRATION[selectedGenre]) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  el.innerHTML = GENRE_INSPIRATION[selectedGenre]
    .map((s) => `<li>${s.title} — ${s.artist}${s.year ? ` (${s.year})` : ""}</li>`)
    .join("");
}

function renderSpotlights() {
  const el = document.getElementById("spotlight-grid");
  const items = SPOTLIGHTS.filter((s) => selectedGenre === "All" || s.genre === selectedGenre);
  el.innerHTML = items
    .map(
      (s) => `
      <div class="spotlight-card">
        <div class="spotlight-embed">
          <iframe src="https://www.youtube-nocookie.com/embed/${s.youtubeId}" title="${s.title} — ${s.artist}"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>
        <h3>${s.title} — ${s.artist}${s.explicit ? " 🅴" : ""}</h3>
        <p>${s.note}</p>
        <button data-song="${s.exampleSongTitle}">Open a similar layered example: "${s.exampleSongTitle}"</button>
      </div>`
    )
    .join("");
  el.querySelectorAll("button[data-song]").forEach((btn) => {
    btn.onclick = () => {
      window.location.href = `index.html?song=${encodeURIComponent(btn.dataset.song)}`;
    };
  });
}

function renderAll() {
  renderTabs();
  renderInspiration();
  renderSpotlights();
}

renderAll();
