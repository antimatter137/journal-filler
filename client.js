(async () => {
    const SERVER_URL = "https://parser.antimatter137.dev/parse-stats";

    console.log("Collecting posts...");

    const postEls = Array.from(document.querySelectorAll('div'));
    const rawPosts = [];

    for (const el of postEls) {
        const text = (el.innerText || el.textContent || "").trim();
        if (!text) continue;

        if (/minutes?/i.test(text) && /steps?/i.test(text)) {
            rawPosts.push(text);
        }
    }

    console.log("Raw posts found (with duplicates):", rawPosts.length);

    const uniqueByText = Array.from(new Set(rawPosts));
    console.log("Unique posts by text:", uniqueByText.length);

    if (!uniqueByText.length) {
        console.warn("No candidate posts found. Scroll/expand more posts and run again.");
        return;
    }

    let data;
    try {
        const res = await fetch(SERVER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ posts: uniqueByText })
        });

        console.log("Fetch completed. Status:", res.status);

        if (!res.ok) {
            const text = await res.text().catch(() => "<unable to read body>");
            console.error("Server returned error:", res.status, text);
            return;
        }

        data = await res.json();
    } catch (err) {
        console.error("Fetch or processing error:", err);
        return;
    }

    const parsed = data.results || [];
    console.log("Parsed rows (raw from server):", parsed.length);

    const seenStat = new Set();
    const dedupedByStat = [];

    for (const r of parsed) {
        const key = JSON.stringify({
            date_label: r.date_label ?? null,
            minutes: r.minutes ?? null,
            miles: r.miles ?? null,
            calories: r.calories ?? null,
            steps: r.steps ?? null
        });
        if (seenStat.has(key)) continue;
        seenStat.add(key);
        dedupedByStat.push(r);
    }

    console.log("After value-based dedupe:", dedupedByStat.length);

    const perDate = {};
    for (const r of dedupedByStat) {
        if (!r.date_label) continue;
        if (!perDate[r.date_label]) {
            perDate[r.date_label] = r;
        }
    }

    const finalRows = Object.values(perDate);
    console.log("Final rows (one per date_label):", finalRows.length);

    console.table(
        finalRows.map((r, i) => ({
            index: i,
            date_label: r.date_label,
            minutes: r.minutes,
            miles: r.miles,
            calories: r.calories,
            steps: r.steps
        }))
    );

    console.log("JSON:");
    console.log(JSON.stringify(finalRows, null, 2));
})();