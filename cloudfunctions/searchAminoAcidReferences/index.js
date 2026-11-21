const { createReferenceSearch } = require('./referenceSearch');

const search = createReferenceSearch(() => require('./references.json'));

exports.main = async event => search(event);
