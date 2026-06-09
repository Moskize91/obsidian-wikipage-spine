export interface EntityPredicateFact {
  pid: number;
  valueQidNumber: number;
}

export const ENTITY_FLAG_DISAMBIGUATION = 1;

const POSITIVE_PREDICATES = new Set<number>([
  69, // educated at
  106, // occupation
  108, // employer
  112, // founded by
  178, // developer
  212, // ISBN-13
  356, // DOI
  496, // ORCID iD
  569, // date of birth
  570, // date of death
  571, // inception
  577, // publication date
  698, // PubMed ID
  800, // notable work
  932, // PMCID
  957, // ISBN-10
]);

export function shouldReportEntity(input: {
  flags: number;
  predicates: Iterable<EntityPredicateFact>;
}): boolean {
  if ((input.flags & ENTITY_FLAG_DISAMBIGUATION) !== 0) {
    return false;
  }

  for (const predicate of input.predicates) {
    if (POSITIVE_PREDICATES.has(predicate.pid)) {
      return true;
    }
  }

  // 第一版宁愿漏掉大多数普通实体，也不让泛权威 ID、P31/P279 或短 surface 误召重新污染正文。
  return false;
}
