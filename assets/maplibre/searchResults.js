export function filterSearchResults(matches, query) {

    const normalizedQuery = query
        .toLowerCase()
        .trim();

    const exactMatches = matches.filter(result => {

        const name = result.item.name?.toLowerCase() ?? '';
        const address = result.item.address?.toLowerCase() ?? '';

        return (
            name.includes(normalizedQuery) ||
            address.includes(normalizedQuery)
        );
    });

    return exactMatches.length
        ? exactMatches
        : matches;
}