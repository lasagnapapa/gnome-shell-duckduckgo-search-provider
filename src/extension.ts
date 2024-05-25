const { Gio, Soup } = imports.gi;
const { main, overview } = imports.ui;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const gicon = Gio.icon_new_for_string(`${Me.dir.get_path()}/logo.svg`);

const getJSON = (() => {
    let httpSession;
    return (url, params) =>
        new Promise((resolve, reject) => {
            try {
                if (!httpSession) {
                    httpSession = new Soup.Session();
                    httpSession.user_agent = "Gnome Shell Extension";
                } else {
                    httpSession.abort();
                }
                const message = Soup.form_request_new_from_hash("GET", url, params);
                httpSession.queue_message(message, () => {
                    try {
                        if (!message.response_body.data) {
                            return reject(new Error("No data in response body"));
                        }
                        resolve(JSON.parse(message.response_body.data));
                    } catch (e) {
                        reject(e);
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
})();

function getIA(q) {
    return getJSON("https://api.duckduckgo.com/", {
        q,
        format: "json",
        pretty: "0",
        no_redirect: "1",
        t: "gnome-shell-search-extension",
    });
}

function getSuggestions(q) {
    return getJSON("https://duckduckgo.com/ac/", { q, t: "gnome-shell-search-extension" });
}

function getResultMeta(id) {
    const { type, answer, query } = JSON.parse(id);
    if (type === "suggestion") {
        return {
            id,
            name: answer,
            description: "Suggested result",
            clipboardText: answer,
            createIcon() {
                return null;
            },
        };
    } else if (type === "bang") {
        const uri = new Soup.URI(answer);
        return {
            id,
            name: `Search ${uri.get_host()} for ${query}`,
            description: "!bang Redirect",
            clipboardText: answer,
            createIcon() {
                return null;
            },
        };
    }
    return {
        id,
        name: answer,
        description: "Search DuckDuckGo",
        clipboardText: answer,
        createIcon() {
            return null;
        },
    };
}

function makeLaunchContext() {
    return global.create_app_launch_context(global.display.get_current_time_roundtrip(), -1);
}

const ddgProvider = {
    appInfo: {
        get_name: () => "DuckDuckGo",
        get_icon: () => gicon,
        get_id: () => "duckduckgo-provider",
        should_show: () => true,
    },

    getResultMetas(results, cb) {
        cb(results.map(getResultMeta));
    },

    activateResult(result) {
        const { type, answer } = JSON.parse(result);
        let url = "";
        if (type === "suggestion" || type === "query") {
            url = `https://duckduckgo.com/?q=${answer}`;
        } else if (type === "bang") {
            url = answer;
        }
        if (url) Gio.app_info_launch_default_for_uri(url, makeLaunchContext());
    },

    filterResults(providerResults, maxResults) {
        return providerResults.slice(0, maxResults);
    },

    async getInitialResultSet(terms, cb) {
        const query = terms.join(" ");
        const results = [JSON.stringify({ type: "query", answer: query })];
        if (query[0] === "!") {
            const ia = await getIA(query);
            if (ia.Type === "E" && ia.Redirect) {
                results.unshift(
                    JSON.stringify({
                        type: "bang",
                        answer: ia.Redirect,
                        query: terms.slice(1).join(" "),
                    })
                );
                return cb(results);
            }
        }
        for (const { phrase } of await getSuggestions(query)) {
            if (phrase === query) continue;
            results.push(
                JSON.stringify({ type: "suggestion", answer: phrase, query })
            );
        }
        global.log(`DDG Results: [${results.join(",")}]`);
        cb(results);
    },

    getSubsearchResultSet(_, terms, cb) {
        this.getInitialResultSet(terms, cb);
    },
};

function getOverviewSearchResult() {
    if (main.overview.viewSelector !== undefined) {
        return main.overview.viewSelector._searchResults;
    } else {
        return main.overview._overview.controls._searchController._searchResults;
    }
}

export function init() {}

let instance;
export function enable() {
    global.log("Enabling DuckDuckGo IA Search Provider");
    instance = Object.create(ddgProvider);
    getOverviewSearchResult()._registerProvider(instance);
}

export function disable() {
    global.log("Disabling DuckDuckGo IA Search Provider");
    getOverviewSearchResult()._unregisterProvider(instance);
}
