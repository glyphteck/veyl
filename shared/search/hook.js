'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { queryKey } from './query.js';

// Generic React search hook. The platform wrapper supplies a context hook and
// a map of named sources; each source describes how to parse input, run the
// remote fetch, filter, and react to results.
//
// Returns:
//   query       — parsed query object or null
//   results     — filtered remote results (already de-blocked)
//   searching   — true while a request is in flight
//   search(v)   — feed the latest input string; debounced internally
//   clearSearch — reset state
export function createSearch({ useSearchContext, sources }) {
    if (typeof useSearchContext !== 'function') {
        throw new Error('createSearch requires useSearchContext');
    }
    if (!sources || typeof sources !== 'object') {
        throw new Error('createSearch requires sources');
    }

    return function useSearch(type) {
        const context = useSearchContext() || {};
        const factory = sources?.[type];
        const source = typeof factory === 'function' ? factory({ context, type }) : factory;

        if (!source) {
            throw new Error(`useSearch: no source registered for "${type}"`);
        }

        const { debounceMs = 0, parse, fetch, filter, onResults } = source;
        if (typeof parse !== 'function' || typeof fetch !== 'function') {
            throw new Error(`useSearch "${type}" source requires parse and fetch`);
        }

        const [searching, setSearching] = useState(false);
        const [results, setResults] = useState([]);
        const [query, setQuery] = useState(null);

        const debounceRef = useRef(null);
        const requestId = useRef(0);
        const currentKey = useRef('');

        const clearSearch = useCallback(() => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            requestId.current += 1;
            currentKey.current = '';
            setSearching(false);
            setResults([]);
            setQuery(null);
        }, []);

        const performFetch = useCallback(
            async (parsed, searchId) => {
                try {
                    const next = await fetch(parsed);
                    if (searchId !== requestId.current) return;
                    const list = Array.isArray(next) ? next : [];
                    setResults(list);
                    if (typeof onResults === 'function') {
                        void Promise.resolve(onResults(list, parsed)).catch((error) => {
                            console.error(`search "${type}" onResults error:`, error);
                        });
                    }
                } catch (error) {
                    console.error(`search "${type}" error:`, error);
                    if (searchId !== requestId.current) return;
                    setResults([]);
                } finally {
                    if (searchId === requestId.current) setSearching(false);
                }
            },
            [fetch, onResults, type]
        );

        const search = useCallback(
            (input) => {
                if (debounceRef.current) clearTimeout(debounceRef.current);

                const parsed = parse(input);
                if (!parsed) {
                    clearSearch();
                    return null;
                }

                const key = queryKey(parsed);
                if (currentKey.current !== key) {
                    requestId.current += 1;
                    setResults([]);
                }
                currentKey.current = key;
                setQuery(parsed);
                setSearching(true);

                const searchId = requestId.current;
                const run = () => {
                    if (searchId !== requestId.current || currentKey.current !== key) return;
                    void performFetch(parsed, searchId);
                };

                if (debounceMs > 0) {
                    debounceRef.current = setTimeout(run, debounceMs);
                } else {
                    run();
                }

                return parsed;
            },
            [clearSearch, debounceMs, parse, performFetch]
        );

        useEffect(
            () => () => {
                if (debounceRef.current) clearTimeout(debounceRef.current);
            },
            []
        );

        useEffect(() => {
            clearSearch();
        }, [clearSearch, type]);

        const filtered = useMemo(() => {
            if (typeof filter !== 'function') return results;
            return filter(results);
        }, [filter, results]);

        return { query, results: filtered, searching, search, clearSearch };
    };
}
