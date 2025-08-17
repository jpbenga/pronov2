function getCombinations(array, k) {
    const result = [];
    function backtrack(combination, start) {
        if (combination.length === k) {
            result.push([...combination]);
            return;
        }
        for (let i = start; i < array.length; i++) {
            combination.push(array[i]);
            backtrack(combination, i + 1);
            combination.pop();
        }
    }
    backtrack([], 0);
    return result;
}

module.exports = { getCombinations };