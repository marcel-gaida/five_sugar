class Fuse {
    constructor(list, options = {}) {
        this.list = list;
        this.keys = options.keys || [];
        this.threshold = options.threshold || 0.4;
    }

    search(pattern) {
        if (!pattern) return [];
        const q = pattern.toLowerCase().trim();
        const results = [];
        
        this.list.forEach(item => {
            let matched = false;
            let bestScore = 1;
            
            for (const key of this.keys) {
                const val = (item[key] || "").toString().toLowerCase();
                if (val === q) {
                    matched = true;
                    bestScore = Math.min(bestScore, 0.0);
                } else if (val.startsWith(q)) {
                    matched = true;
                    bestScore = Math.min(bestScore, 0.1);
                } else if (val.includes(" " + q)) {
                    matched = true;
                    bestScore = Math.min(bestScore, 0.2);
                } else if (val.includes(q)) {
                    matched = true;
                    bestScore = Math.min(bestScore, 0.3);
                } else {
                    // letter-by-letter fuzzy match
                    let itemIdx = 0;
                    let queryIdx = 0;
                    while (itemIdx < val.length && queryIdx < q.length) {
                        if (val[itemIdx] === q[queryIdx]) {
                            queryIdx++;
                        }
                        itemIdx++;
                    }
                    if (queryIdx === q.length) {
                        matched = true;
                        // Score based on relative length difference
                        const score = 0.4 + ((val.length - q.length) / val.length) * 0.5;
                        bestScore = Math.min(bestScore, score);
                    }
                }
            }
            
            if (matched && bestScore <= this.threshold) {
                results.push({ item, score: bestScore });
            }
        });
        
        return results.sort((a, b) => a.score - b.score);
    }
}
