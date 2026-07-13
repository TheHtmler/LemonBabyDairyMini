function countFilledIndicators(currentIndicators = [], indicatorData = {}) {
  return (currentIndicators || []).reduce((n, item) => {
    const value = indicatorData[item.key]?.value;
    return n + (value && String(value).trim() !== '' ? 1 : 0);
  }, 0);
}

module.exports = { countFilledIndicators };
