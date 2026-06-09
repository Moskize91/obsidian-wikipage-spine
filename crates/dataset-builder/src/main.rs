extern crate alloc;

#[allow(dead_code, unused_imports)]
mod compact_ac;

use crate::compact_ac::{CharwiseDoubleArrayAhoCorasickBuilder, DoubleArrayAhoCorasickBuilder};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::env;
use std::error::Error;
use std::fmt;
use std::fs::{self, File};
use std::io::{copy, BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_USER_AGENT: &str =
    "obsidian-wikipage-spine-dataset-builder/0.1 (+https://github.com/moskize91/obsidian-wikipage-spine)";
const WIKIMEDIA_DUMPS_BASE: &str = "https://dumps.wikimedia.org";
const ENTITY_FLAG_DISAMBIGUATION: u32 = 1;
const WIKIDATA_DISAMBIGUATION_QID: u32 = 4_167_410;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Debug)]
struct CliError(String);

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Error for CliError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Component {
    Page,
    Redirect,
    PageProps,
    WikidataEntities,
}

impl Component {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "page" => Ok(Self::Page),
            "redirect" => Ok(Self::Redirect),
            "page_props" | "page-props" => Ok(Self::PageProps),
            "wikidata_entities" | "wikidata-entities" => Ok(Self::WikidataEntities),
            _ => Err(CliError(format!("unknown component: {value}")).into()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Page => "page",
            Self::Redirect => "redirect",
            Self::PageProps => "page_props",
            Self::WikidataEntities => "wikidata_entities",
        }
    }
}

#[derive(Debug)]
struct DownloadArgs {
    out: PathBuf,
    wikis: Vec<String>,
    components: Vec<Component>,
    date: String,
    dry_run: bool,
    force: bool,
    user_agent: String,
}

impl Default for DownloadArgs {
    fn default() -> Self {
        Self {
            out: PathBuf::from("crates/data/dumps"),
            wikis: vec!["zhwiki".to_string(), "enwiki".to_string()],
            components: vec![Component::Page, Component::Redirect, Component::PageProps],
            date: "latest".to_string(),
            dry_run: false,
            force: false,
            user_agent: DEFAULT_USER_AGENT.to_string(),
        }
    }
}

#[derive(Debug)]
struct DownloadTarget {
    component: Component,
    wiki: Option<String>,
    url: String,
    path: PathBuf,
}

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        print_help();
        return Ok(());
    };

    match command.as_str() {
        "download" => download(parse_download_args(args.collect())?),
        "process" | "preprocess" => preprocess(parse_process_args(args.collect())?),
        "compile" => compile(parse_compile_args(args.collect())?),
        "postprocess" => postprocess(parse_postprocess_args(args.collect())?),
        "-h" | "--help" | "help" => {
            print_help();
            Ok(())
        }
        _ => Err(CliError(format!("unknown command: {command}")).into()),
    }
}

#[derive(Debug)]
struct ProcessArgs {
    dumps: PathBuf,
    out: PathBuf,
    wikis: Vec<String>,
    date: String,
    limit: Option<usize>,
}

impl Default for ProcessArgs {
    fn default() -> Self {
        Self {
            dumps: PathBuf::from("crates/data/dumps"),
            out: PathBuf::from("crates/data/preprocess"),
            wikis: vec!["zhwiki".to_string(), "enwiki".to_string()],
            date: "latest".to_string(),
            limit: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CompileMode {
    Charwise,
    Bytewise,
}

impl CompileMode {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "charwise" | "char" => Ok(Self::Charwise),
            "bytewise" | "byte" => Ok(Self::Bytewise),
            _ => Err(CliError(format!("unknown compile mode: {value}")).into()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Charwise => "charwise",
            Self::Bytewise => "bytewise",
        }
    }
}

#[derive(Debug)]
struct CompileArgs {
    preprocess: PathBuf,
    out: PathBuf,
    mode: CompileMode,
    limit: Option<usize>,
    progress_every: usize,
}

impl Default for CompileArgs {
    fn default() -> Self {
        Self {
            preprocess: PathBuf::from("crates/data/preprocess"),
            out: PathBuf::from("crates/data/compile"),
            mode: CompileMode::Charwise,
            limit: None,
            progress_every: 100_000,
        }
    }
}

#[derive(Debug)]
struct PostprocessArgs {
    preprocess: PathBuf,
    compile: PathBuf,
    out: PathBuf,
    progress_every: usize,
}

impl Default for PostprocessArgs {
    fn default() -> Self {
        Self {
            preprocess: PathBuf::from("crates/data/preprocess"),
            compile: PathBuf::from("crates/data/compile"),
            out: PathBuf::from("crates/data/runtime"),
            progress_every: 100_000,
        }
    }
}

#[derive(Debug)]
struct Page {
    title: String,
    qid: Option<String>,
}

#[derive(Debug)]
struct SurfaceRow {
    wiki: String,
    surface_key: String,
    surface_text: String,
    qid: String,
    source: &'static str,
    page_id: u64,
    target_page_id: u64,
}

#[derive(Clone, Debug, Default)]
struct EntityFact {
    flags: u32,
    predicates: Vec<(u32, u32)>,
}

fn parse_download_args(raw_args: Vec<String>) -> Result<DownloadArgs> {
    let mut args = DownloadArgs::default();
    let mut index = 0;

    while index < raw_args.len() {
        match raw_args[index].as_str() {
            "--out" => {
                index += 1;
                args.out = PathBuf::from(require_value(&raw_args, index, "--out")?);
            }
            "--wikis" => {
                index += 1;
                args.wikis = split_csv(require_value(&raw_args, index, "--wikis")?);
            }
            "--components" => {
                index += 1;
                args.components = split_csv(require_value(&raw_args, index, "--components")?)
                    .into_iter()
                    .map(|value| Component::parse(&value))
                    .collect::<Result<Vec<_>>>()?;
            }
            "--date" => {
                index += 1;
                args.date = require_value(&raw_args, index, "--date")?.to_string();
            }
            "--user-agent" => {
                index += 1;
                args.user_agent = require_value(&raw_args, index, "--user-agent")?.to_string();
            }
            "--dry-run" => args.dry_run = true,
            "--force" => args.force = true,
            "-h" | "--help" => {
                print_download_help();
                std::process::exit(0);
            }
            unknown => return Err(CliError(format!("unknown download option: {unknown}")).into()),
        }
        index += 1;
    }

    if args.wikis.is_empty() {
        return Err(CliError("at least one wiki must be selected".to_string()).into());
    }
    if args.components.is_empty() {
        return Err(CliError("at least one component must be selected".to_string()).into());
    }
    validate_date(&args.date)?;

    Ok(args)
}

fn parse_process_args(raw_args: Vec<String>) -> Result<ProcessArgs> {
    let mut args = ProcessArgs::default();
    let mut index = 0;

    while index < raw_args.len() {
        match raw_args[index].as_str() {
            "--dumps" => {
                index += 1;
                args.dumps = PathBuf::from(require_value(&raw_args, index, "--dumps")?);
            }
            "--out" => {
                index += 1;
                args.out = PathBuf::from(require_value(&raw_args, index, "--out")?);
            }
            "--wikis" => {
                index += 1;
                args.wikis = split_csv(require_value(&raw_args, index, "--wikis")?);
            }
            "--date" => {
                index += 1;
                args.date = require_value(&raw_args, index, "--date")?.to_string();
            }
            "--limit" => {
                index += 1;
                let value = require_value(&raw_args, index, "--limit")?;
                args.limit = Some(value.parse::<usize>().map_err(|err| {
                    CliError(format!("--limit must be a positive integer: {err}"))
                })?);
            }
            "-h" | "--help" => {
                print_process_help();
                std::process::exit(0);
            }
            unknown => return Err(CliError(format!("unknown process option: {unknown}")).into()),
        }
        index += 1;
    }

    if args.wikis.is_empty() {
        return Err(CliError("at least one wiki must be selected".to_string()).into());
    }
    validate_date(&args.date)?;

    Ok(args)
}

fn parse_compile_args(raw_args: Vec<String>) -> Result<CompileArgs> {
    let mut args = CompileArgs::default();
    let mut index = 0;

    while index < raw_args.len() {
        match raw_args[index].as_str() {
            "--preprocess" => {
                index += 1;
                args.preprocess = PathBuf::from(require_value(&raw_args, index, "--preprocess")?);
            }
            "--out" => {
                index += 1;
                args.out = PathBuf::from(require_value(&raw_args, index, "--out")?);
            }
            "--mode" => {
                index += 1;
                args.mode = CompileMode::parse(require_value(&raw_args, index, "--mode")?)?;
            }
            "--limit" => {
                index += 1;
                let value = require_value(&raw_args, index, "--limit")?;
                args.limit = Some(value.parse::<usize>().map_err(|err| {
                    CliError(format!("--limit must be a positive integer: {err}"))
                })?);
            }
            "--progress-every" => {
                index += 1;
                let value = require_value(&raw_args, index, "--progress-every")?;
                args.progress_every = value.parse::<usize>().map_err(|err| {
                    CliError(format!(
                        "--progress-every must be a positive integer: {err}"
                    ))
                })?;
            }
            "-h" | "--help" => {
                print_compile_help();
                std::process::exit(0);
            }
            unknown => return Err(CliError(format!("unknown compile option: {unknown}")).into()),
        }
        index += 1;
    }

    if args.progress_every == 0 {
        return Err(CliError("--progress-every must be greater than zero".to_string()).into());
    }

    Ok(args)
}

fn parse_postprocess_args(raw_args: Vec<String>) -> Result<PostprocessArgs> {
    let mut args = PostprocessArgs::default();
    let mut index = 0;

    while index < raw_args.len() {
        match raw_args[index].as_str() {
            "--preprocess" => {
                index += 1;
                args.preprocess = PathBuf::from(require_value(&raw_args, index, "--preprocess")?);
            }
            "--compile" => {
                index += 1;
                args.compile = PathBuf::from(require_value(&raw_args, index, "--compile")?);
            }
            "--out" => {
                index += 1;
                args.out = PathBuf::from(require_value(&raw_args, index, "--out")?);
            }
            "--progress-every" => {
                index += 1;
                let value = require_value(&raw_args, index, "--progress-every")?;
                args.progress_every = value.parse::<usize>().map_err(|err| {
                    CliError(format!(
                        "--progress-every must be a positive integer: {err}"
                    ))
                })?;
            }
            "-h" | "--help" => {
                print_postprocess_help();
                std::process::exit(0);
            }
            unknown => {
                return Err(CliError(format!("unknown postprocess option: {unknown}")).into())
            }
        }
        index += 1;
    }

    if args.progress_every == 0 {
        return Err(CliError("--progress-every must be greater than zero".to_string()).into());
    }

    Ok(args)
}

fn require_value<'a>(args: &'a [String], index: usize, option: &str) -> Result<&'a str> {
    args.get(index)
        .map(String::as_str)
        .filter(|value| !value.starts_with("--"))
        .ok_or_else(|| CliError(format!("{option} requires a value")).into())
}

fn split_csv(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn download(args: DownloadArgs) -> Result<()> {
    let targets = build_targets(&args)?;
    if targets.is_empty() {
        return Err(CliError("no download targets selected".to_string()).into());
    }

    if args.dry_run {
        for target in &targets {
            println!("{} -> {}", target.url, target.path.display());
        }
        return Ok(());
    }

    require_curl()?;
    fs::create_dir_all(&args.out)?;
    clean_download_target_dirs(&targets)?;

    for target in &targets {
        download_target(target, &args.user_agent, args.force)?;
    }

    write_manifest(&args.out.join("manifest.json"), &args.date, &targets)?;
    eprintln!("wrote {}", args.out.join("manifest.json").display());

    Ok(())
}

fn clean_download_target_dirs(targets: &[DownloadTarget]) -> Result<()> {
    let mut cleaned = HashSet::<PathBuf>::new();
    for target in targets {
        let Some(parent) = target.path.parent() else {
            continue;
        };
        let parent = parent.to_path_buf();
        if cleaned.insert(parent.clone()) && parent.exists() {
            fs::remove_dir_all(parent)?;
        }
    }
    Ok(())
}

fn preprocess(args: ProcessArgs) -> Result<()> {
    require_gzip()?;
    let out_dir = args.out.clone();
    if out_dir.exists() {
        fs::remove_dir_all(&out_dir)?;
    }
    fs::create_dir_all(&out_dir)?;

    let mut all_surfaces = Vec::new();
    let mut summaries = Vec::new();

    for wiki in &args.wikis {
        let page_path = dump_path(&args.dumps, wiki, &args.date, "page");
        let page_props_path = dump_path(&args.dumps, wiki, &args.date, "page_props");
        let redirect_path = dump_path(&args.dumps, wiki, &args.date, "redirect");

        eprintln!("processing {wiki} page table");
        let mut pages = read_pages(&page_path, args.limit)?;

        eprintln!("processing {wiki} page_props table");
        let qid_count = attach_page_qids(&page_props_path, &mut pages, args.limit)?;

        eprintln!("processing {wiki} redirect table");
        let redirects = read_redirects(wiki, &redirect_path, &pages, args.limit)?;

        let surfaces = build_surface_rows(wiki, &pages, &redirects);
        summaries.push(format!(
            "{wiki}\tpages_ns0={}\tpages_with_qid={qid_count}\tredirects_with_qid={}\tsurface_sources={}",
            pages.len(),
            redirects.len(),
            surfaces.len()
        ));

        all_surfaces.extend(surfaces);
    }

    let surface_qids = build_surface_qid_lists(&all_surfaces);
    summaries.push(format!(
        "global\tsurface_sources={}\tsurface_keys={}\tambiguous_surface_keys={}",
        all_surfaces.len(),
        surface_qids.len(),
        count_ambiguous_surfaces(&surface_qids)
    ));

    let surface_qid_numbers = collect_surface_qid_numbers(&surface_qids)?;
    eprintln!(
        "processing Wikidata entity facts for {} QIDs",
        surface_qid_numbers.len()
    );
    let entity_facts =
        read_wikidata_entity_facts(&args.dumps, &args.date, &surface_qid_numbers, args.limit)?;

    write_surface_sources_tsv(&out_dir.join("surface_sources.tsv"), &all_surfaces)?;
    write_surface_qid_lists_tsv(&out_dir.join("surface_qids.tsv"), &surface_qids)?;
    write_entity_facts_tsv(
        &out_dir.join("entity_facts.tsv"),
        &surface_qid_numbers,
        &entity_facts,
    )?;
    write_preprocess_manifest(&out_dir.join("manifest.json"), &args, &summaries)?;

    for summary in summaries {
        println!("{summary}");
    }

    Ok(())
}

fn compile(args: CompileArgs) -> Result<()> {
    let input_path = args.preprocess.join("surface_qids.tsv");
    if !input_path.exists() {
        return Err(CliError(format!("missing preprocess file: {}", input_path.display())).into());
    }

    let tmp_dir = compile_tmp_dir(&args.out);
    if tmp_dir.exists() {
        fs::remove_dir_all(&tmp_dir)?;
    }
    if args.out.exists() {
        fs::remove_dir_all(&args.out)?;
    }
    fs::create_dir_all(&tmp_dir)?;

    let progress_path = tmp_dir.join("progress.tsv");
    write_compile_progress(&progress_path, "ingest_started", 0, 0)?;

    let mut patterns = Vec::<String>::new();
    let mut pattern_bytes = 0usize;
    let input = File::open(&input_path)?;
    let reader = BufReader::new(input);

    for (line_number, line) in reader.lines().enumerate() {
        let line = line?;
        if line_number == 0 {
            validate_surface_qids_header(&line)?;
            continue;
        }
        if let Some(limit) = args.limit {
            if patterns.len() >= limit {
                break;
            }
        }
        let Some(surface_key) = first_tsv_column(&line) else {
            return Err(CliError(format!(
                "invalid surface_qids row without tab at line {}",
                line_number + 1
            ))
            .into());
        };
        let surface_key = unescape_tsv(surface_key);
        if surface_key.is_empty() {
            return Err(CliError(format!(
                "empty surface_key at surface_qids.tsv line {}",
                line_number + 1
            ))
            .into());
        }

        pattern_bytes += surface_key.len();
        patterns.push(surface_key);

        if patterns.len() % args.progress_every == 0 {
            eprintln!(
                "ingested surface_id={} surfaces={} pattern_bytes={}",
                patterns.len() - 1,
                patterns.len(),
                pattern_bytes
            );
            write_compile_progress(&progress_path, "ingesting", patterns.len(), pattern_bytes)?;
        }
    }

    if patterns.is_empty() {
        return Err(CliError("no surface keys found for compile".to_string()).into());
    }

    eprintln!(
        "building {} automaton surfaces={} pattern_bytes={}",
        args.mode.as_str(),
        patterns.len(),
        pattern_bytes
    );
    let surface_count = patterns.len();
    write_compile_progress(
        &progress_path,
        "build_started",
        surface_count,
        pattern_bytes,
    )?;

    let automaton_bytes = build_automaton_bytes(patterns, args.mode)?;
    let automaton_path = tmp_dir.join("automaton.bin");
    let mut automaton_file = BufWriter::new(File::create(&automaton_path)?);
    automaton_file.write_all(&automaton_bytes)?;
    automaton_file.flush()?;

    let automaton_size = automaton_path.metadata()?.len();
    write_compile_manifest(
        &tmp_dir.join("manifest.json"),
        &args,
        &input_path,
        surface_count,
        pattern_bytes,
        automaton_size,
    )?;
    write_compile_progress(&progress_path, "done", surface_count, pattern_bytes)?;

    fs::rename(&tmp_dir, &args.out)?;
    eprintln!(
        "wrote {} ({} bytes)",
        args.out.join("automaton.bin").display(),
        automaton_size
    );

    Ok(())
}

#[derive(Debug)]
struct RuntimeQidStats {
    surface_count: usize,
    surface_eid_value_count: usize,
    eid_count: usize,
    predicate_value_count: usize,
    max_qid: u32,
    max_pid: u32,
}

#[derive(Debug)]
struct RuntimeAutomatonStats {
    automaton_bytes: u64,
    states_len: u32,
    mapper_table_len: u32,
    alphabet_size: u32,
    output_count: u32,
    match_kind: u8,
    num_states: u32,
}

fn postprocess(args: PostprocessArgs) -> Result<()> {
    let surface_qids_path = args.preprocess.join("surface_qids.tsv");
    if !surface_qids_path.exists() {
        return Err(CliError(format!(
            "missing preprocess file: {}",
            surface_qids_path.display()
        ))
        .into());
    }
    let automaton_path = args.compile.join("automaton.bin");
    if !automaton_path.exists() {
        return Err(CliError(format!(
            "missing compile file: {}",
            automaton_path.display()
        ))
        .into());
    }

    let tmp_dir = postprocess_tmp_dir(&args.out);
    if tmp_dir.exists() {
        fs::remove_dir_all(&tmp_dir)?;
    }
    if args.out.exists() {
        fs::remove_dir_all(&args.out)?;
    }

    let automaton_out_dir = tmp_dir.join("automaton");
    let surfaces_out_dir = tmp_dir.join("surfaces");
    let eids_out_dir = tmp_dir.join("eids");
    fs::create_dir_all(&automaton_out_dir)?;
    fs::create_dir_all(&surfaces_out_dir)?;
    fs::create_dir_all(&eids_out_dir)?;

    eprintln!("postprocessing entity tables");
    let (surface_utf16_lengths, qid_stats) = write_runtime_entity_tables(
        &surface_qids_path,
        &args.preprocess.join("entity_facts.tsv"),
        &surfaces_out_dir,
        &eids_out_dir,
        args.progress_every,
    )?;

    eprintln!("postprocessing automaton tables");
    let automaton_stats = write_runtime_automaton_tables(
        &automaton_path,
        &automaton_out_dir,
        &surface_utf16_lengths,
        args.progress_every,
    )?;
    if automaton_stats.output_count as usize != qid_stats.surface_count {
        return Err(CliError(format!(
            "automaton output count {} does not match surface count {}",
            automaton_stats.output_count, qid_stats.surface_count
        ))
        .into());
    }

    write_runtime_manifest(
        &tmp_dir.join("manifest.json"),
        &args,
        &surface_qids_path,
        &automaton_path,
        &qid_stats,
        &automaton_stats,
    )?;

    fs::rename(&tmp_dir, &args.out)?;
    eprintln!("wrote {}", args.out.display());

    Ok(())
}

fn write_runtime_entity_tables(
    surface_qids_path: &Path,
    entity_facts_path: &Path,
    surfaces_out_dir: &Path,
    eids_out_dir: &Path,
    progress_every: usize,
) -> Result<(Vec<u32>, RuntimeQidStats)> {
    let entity_facts = read_entity_facts_tsv(entity_facts_path)?;
    let mut surface_utf16_lengths = Vec::<u32>::new();
    let mut qid_set = HashSet::<u32>::new();

    for (line_number, line) in BufReader::new(File::open(surface_qids_path)?)
        .lines()
        .enumerate()
    {
        let line = line?;
        if line_number == 0 {
            validate_surface_qids_header(&line)?;
            continue;
        }
        let (surface_key, qids, qid_count) = parse_surface_qids_row(&line, line_number + 1)?;
        if qids.len() != qid_count {
            return Err(CliError(format!(
                "qid_count mismatch at line {}: parsed {}, declared {}",
                line_number + 1,
                qids.len(),
                qid_count
            ))
            .into());
        }
        let utf16_len = u32::try_from(surface_key.encode_utf16().count()).map_err(|_| {
            CliError(format!(
                "surface_key UTF-16 length overflow at line {}",
                line_number + 1
            ))
        })?;
        surface_utf16_lengths.push(utf16_len);
        qid_set.extend(qids);
    }

    let mut qids = qid_set.into_iter().collect::<Vec<_>>();
    qids.sort_unstable();
    let qid_to_eid_id = qids
        .iter()
        .enumerate()
        .map(|(index, qid)| (*qid, checked_surface_id(index)))
        .collect::<HashMap<_, _>>();
    let mut surface_eid_index = BufWriter::new(File::create(
        surfaces_out_dir.join("surface_eid_index.bin"),
    )?);
    let mut surface_eid_values = BufWriter::new(File::create(
        surfaces_out_dir.join("surface_eid_values.bin"),
    )?);

    let mut surface_eid_value_count = 0usize;
    for (line_number, line) in BufReader::new(File::open(surface_qids_path)?)
        .lines()
        .enumerate()
    {
        let line = line?;
        if line_number == 0 {
            validate_surface_qids_header(&line)?;
            continue;
        }
        let (_surface_key, qids, _qid_count) = parse_surface_qids_row(&line, line_number + 1)?;
        let offset = u32::try_from(surface_eid_value_count)
            .map_err(|_| CliError("surface EID value offset overflowed u32".to_string()))?;
        let length = u32::try_from(qids.len())
            .map_err(|_| CliError("surface EID list length overflowed u32".to_string()))?;
        write_u32(&mut surface_eid_index, offset)?;
        write_u32(&mut surface_eid_index, length)?;
        for qid in qids {
            let eid_id = qid_to_eid_id.get(&qid).copied().ok_or_else(|| {
                CliError(format!("surface row references unknown QID number {qid}"))
            })?;
            write_u32(&mut surface_eid_values, eid_id)?;
            surface_eid_value_count += 1;
        }

        let surface_count = line_number;
        if surface_count % progress_every == 0 {
            eprintln!(
                "postprocessed surface EIDs surface_id={} surfaces={} surface_eid_values={}",
                surface_count - 1,
                surface_count,
                surface_eid_value_count
            );
        }
    }
    surface_eid_index.flush()?;
    surface_eid_values.flush()?;

    let mut qid_numbers = BufWriter::new(File::create(eids_out_dir.join("qid_numbers.bin"))?);
    let mut flags = BufWriter::new(File::create(eids_out_dir.join("flags.bin"))?);
    let mut predicate_index =
        BufWriter::new(File::create(eids_out_dir.join("predicate_index.bin"))?);
    let mut predicate_values =
        BufWriter::new(File::create(eids_out_dir.join("predicate_values.bin"))?);

    let mut predicate_value_count = 0usize;
    let mut max_qid = 0u32;
    let mut max_pid = 0u32;
    for qid in &qids {
        max_qid = max_qid.max(*qid);
        let fact = entity_facts.get(qid).cloned().unwrap_or_default();
        write_u32(&mut qid_numbers, *qid)?;
        write_u32(&mut flags, fact.flags)?;
        let offset = u32::try_from(predicate_value_count)
            .map_err(|_| CliError("predicate value offset overflowed u32".to_string()))?;
        let length = u32::try_from(fact.predicates.len())
            .map_err(|_| CliError("predicate list length overflowed u32".to_string()))?;
        write_u32(&mut predicate_index, offset)?;
        write_u32(&mut predicate_index, length)?;
        for (pid, value_qid) in fact.predicates {
            max_pid = max_pid.max(pid);
            max_qid = max_qid.max(value_qid);
            write_u32(&mut predicate_values, pid)?;
            write_u32(&mut predicate_values, value_qid)?;
            predicate_value_count += 1;
        }
    }
    qid_numbers.flush()?;
    flags.flush()?;
    predicate_index.flush()?;
    predicate_values.flush()?;

    let stats = RuntimeQidStats {
        surface_count: surface_utf16_lengths.len(),
        surface_eid_value_count,
        eid_count: qids.len(),
        predicate_value_count,
        max_qid,
        max_pid,
    };
    Ok((surface_utf16_lengths, stats))
}

fn write_runtime_automaton_tables(
    automaton_path: &Path,
    automaton_out_dir: &Path,
    surface_utf16_lengths: &[u32],
    progress_every: usize,
) -> Result<RuntimeAutomatonStats> {
    let automaton_bytes = automaton_path.metadata()?.len();
    let input = File::open(automaton_path)?;
    let mut reader = BufReader::new(input);

    let states_len = read_u32(&mut reader)?;
    let mut states_out = BufWriter::new(File::create(automaton_out_dir.join("states.bin"))?);
    copy_exact_bytes(
        &mut reader,
        &mut states_out,
        u64::from(states_len) * 16,
        "states",
    )?;
    states_out.flush()?;

    let mapper_table_len = read_u32(&mut reader)?;
    let mut mapper_out = BufWriter::new(File::create(automaton_out_dir.join("char_code_map.bin"))?);
    copy_exact_bytes(
        &mut reader,
        &mut mapper_out,
        u64::from(mapper_table_len) * 4,
        "char_code_map",
    )?;
    mapper_out.flush()?;
    let alphabet_size = read_u32(&mut reader)?;

    let output_count = read_u32(&mut reader)?;
    let mut outputs_out =
        BufWriter::new(File::create(automaton_out_dir.join("state_outputs.bin"))?);
    for index in 0..output_count {
        let surface_id = read_u32(&mut reader)?;
        let _utf8_len = read_u32(&mut reader)?;
        let parent_output_pos = read_u32(&mut reader)?;
        let utf16_len = surface_utf16_lengths
            .get(surface_id as usize)
            .copied()
            .ok_or_else(|| {
                CliError(format!(
                    "automaton output references unknown surface_id {surface_id}"
                ))
            })?;
        write_u32(&mut outputs_out, surface_id)?;
        write_u32(&mut outputs_out, utf16_len)?;
        write_u32(&mut outputs_out, parent_output_pos)?;

        let done = index as usize + 1;
        if done % progress_every == 0 {
            eprintln!(
                "postprocessed outputs output_id={} outputs={}",
                done - 1,
                done
            );
        }
    }
    outputs_out.flush()?;

    let match_kind = read_u8(&mut reader)?;
    let num_states = read_u32(&mut reader)?;
    let mut trailing = [0u8; 1];
    let trailing_bytes = reader.read(&mut trailing)?;
    if trailing_bytes != 0 {
        return Err(CliError("unexpected trailing bytes in automaton.bin".to_string()).into());
    }

    Ok(RuntimeAutomatonStats {
        automaton_bytes,
        states_len,
        mapper_table_len,
        alphabet_size,
        output_count,
        match_kind,
        num_states,
    })
}

fn write_runtime_manifest(
    path: &Path,
    args: &PostprocessArgs,
    surface_qids_path: &Path,
    automaton_path: &Path,
    qid_stats: &RuntimeQidStats,
    automaton_stats: &RuntimeAutomatonStats,
) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "{{")?;
    writeln!(file, "  \"format\": \"wikipage-spine-runtime-v1\",")?;
    writeln!(file, "  \"generated_at_unix\": {},", generated_at_unix())?;
    writeln!(
        file,
        "  \"preprocess\": \"{}\",",
        escape_json(&path_for_manifest(&args.preprocess))
    )?;
    writeln!(
        file,
        "  \"compile\": \"{}\",",
        escape_json(&path_for_manifest(&args.compile))
    )?;
    writeln!(
        file,
        "  \"input_surface_qids\": \"{}\",",
        escape_json(&path_for_manifest(surface_qids_path))
    )?;
    writeln!(
        file,
        "  \"input_automaton\": \"{}\",",
        escape_json(&path_for_manifest(automaton_path))
    )?;
    writeln!(file, "  \"endian\": \"little\",")?;
    writeln!(file, "  \"mode\": \"charwise\",")?;
    writeln!(file, "  \"match_kind\": {},", automaton_stats.match_kind)?;
    writeln!(file, "  \"state_record_bytes\": 16,")?;
    writeln!(file, "  \"state_output_record_bytes\": 12,")?;
    writeln!(file, "  \"surface_eid_index_record_bytes\": 8,")?;
    writeln!(file, "  \"eid_predicate_index_record_bytes\": 8,")?;
    writeln!(file, "  \"eid_predicate_value_record_bytes\": 8,")?;
    writeln!(file, "  \"states_len\": {},", automaton_stats.states_len)?;
    writeln!(file, "  \"num_states\": {},", automaton_stats.num_states)?;
    writeln!(
        file,
        "  \"mapper_table_len\": {},",
        automaton_stats.mapper_table_len
    )?;
    writeln!(
        file,
        "  \"alphabet_size\": {},",
        automaton_stats.alphabet_size
    )?;
    writeln!(file, "  \"surface_count\": {},", qid_stats.surface_count)?;
    writeln!(
        file,
        "  \"state_output_count\": {},",
        automaton_stats.output_count
    )?;
    writeln!(
        file,
        "  \"surface_eid_value_count\": {},",
        qid_stats.surface_eid_value_count
    )?;
    writeln!(file, "  \"eid_count\": {},", qid_stats.eid_count)?;
    writeln!(
        file,
        "  \"eid_predicate_value_count\": {},",
        qid_stats.predicate_value_count
    )?;
    writeln!(file, "  \"max_qid\": {},", qid_stats.max_qid)?;
    writeln!(file, "  \"max_pid\": {},", qid_stats.max_pid)?;
    writeln!(
        file,
        "  \"source_automaton_bytes\": {},",
        automaton_stats.automaton_bytes
    )?;
    writeln!(file, "  \"files\": {{")?;
    writeln!(
        file,
        "    \"char_code_map\": \"automaton/char_code_map.bin\","
    )?;
    writeln!(file, "    \"states\": \"automaton/states.bin\",")?;
    writeln!(
        file,
        "    \"state_outputs\": \"automaton/state_outputs.bin\","
    )?;
    writeln!(
        file,
        "    \"surface_eid_index\": \"surfaces/surface_eid_index.bin\","
    )?;
    writeln!(
        file,
        "    \"surface_eid_values\": \"surfaces/surface_eid_values.bin\","
    )?;
    writeln!(file, "    \"eid_qid_numbers\": \"eids/qid_numbers.bin\",")?;
    writeln!(file, "    \"eid_flags\": \"eids/flags.bin\",")?;
    writeln!(
        file,
        "    \"eid_predicate_index\": \"eids/predicate_index.bin\","
    )?;
    writeln!(
        file,
        "    \"eid_predicate_values\": \"eids/predicate_values.bin\""
    )?;
    writeln!(file, "  }}")?;
    writeln!(file, "}}")?;
    Ok(())
}

fn parse_surface_qids_row(line: &str, line_number: usize) -> Result<(String, Vec<u32>, usize)> {
    let mut parts = line.splitn(3, '\t');
    let surface_key = parts
        .next()
        .ok_or_else(|| CliError(format!("missing surface_key at line {line_number}")))?;
    let qids = parts
        .next()
        .ok_or_else(|| CliError(format!("missing qids at line {line_number}")))?;
    let qid_count = parts
        .next()
        .ok_or_else(|| CliError(format!("missing qid_count at line {line_number}")))?;

    let surface_key = unescape_tsv(surface_key);
    if surface_key.is_empty() {
        return Err(CliError(format!("empty surface_key at line {line_number}")).into());
    }
    let qids = unescape_tsv(qids)
        .split('|')
        .filter(|value| !value.is_empty())
        .map(|value| parse_qid_number(value, line_number))
        .collect::<Result<Vec<_>>>()?;
    let qid_count = qid_count
        .parse::<usize>()
        .map_err(|err| CliError(format!("invalid qid_count at line {line_number}: {err}")))?;

    Ok((surface_key, qids, qid_count))
}

fn read_entity_facts_tsv(path: &Path) -> Result<HashMap<u32, EntityFact>> {
    let mut facts = HashMap::new();
    if !path.exists() {
        eprintln!(
            "missing preprocess file {}; using empty entity facts",
            path.display()
        );
        return Ok(facts);
    }
    for (line_number, line) in BufReader::new(File::open(path)?).lines().enumerate() {
        let line = line?;
        if line_number == 0 {
            validate_entity_facts_header(&line)?;
            continue;
        }
        let (qid, fact) = parse_entity_facts_row(&line, line_number + 1)?;
        facts.insert(qid, fact);
    }
    Ok(facts)
}

fn parse_entity_facts_row(line: &str, line_number: usize) -> Result<(u32, EntityFact)> {
    let mut parts = line.splitn(4, '\t');
    let qid = parts
        .next()
        .ok_or_else(|| CliError(format!("missing qid at line {line_number}")))?;
    let flags = parts
        .next()
        .ok_or_else(|| CliError(format!("missing flags at line {line_number}")))?;
    let predicate_pairs = parts
        .next()
        .ok_or_else(|| CliError(format!("missing predicate_pairs at line {line_number}")))?;
    let predicate_count = parts
        .next()
        .ok_or_else(|| CliError(format!("missing predicate_count at line {line_number}")))?;

    let qid = parse_qid_number(qid, line_number)?;
    let flags = flags
        .parse::<u32>()
        .map_err(|err| CliError(format!("invalid flags at line {line_number}: {err}")))?;
    let predicate_count = predicate_count.parse::<usize>().map_err(|err| {
        CliError(format!(
            "invalid predicate_count at line {line_number}: {err}"
        ))
    })?;
    let predicates = parse_predicate_pairs(&unescape_tsv(predicate_pairs), line_number)?;
    if predicates.len() != predicate_count {
        return Err(CliError(format!(
            "predicate_count mismatch at line {}: parsed {}, declared {}",
            line_number,
            predicates.len(),
            predicate_count
        ))
        .into());
    }
    Ok((qid, EntityFact { flags, predicates }))
}

fn parse_predicate_pairs(value: &str, line_number: usize) -> Result<Vec<(u32, u32)>> {
    if value.is_empty() {
        return Ok(Vec::new());
    }
    value
        .split('|')
        .map(|pair| {
            let (pid, value_qid) = pair.split_once('=').ok_or_else(|| {
                CliError(format!(
                    "invalid predicate pair `{pair}` at line {line_number}"
                ))
            })?;
            let pid = pid
                .strip_prefix('P')
                .ok_or_else(|| CliError(format!("invalid PID `{pid}` at line {line_number}")))?
                .parse::<u32>()
                .map_err(|err| {
                    CliError(format!(
                        "PID `{pid}` exceeds runtime u32 encoding at line {line_number}: {err}"
                    ))
                })?;
            let value_qid = if value_qid.is_empty() {
                0
            } else {
                parse_qid_number(value_qid, line_number)?
            };
            Ok((pid, value_qid))
        })
        .collect::<Result<Vec<_>>>()
}

fn parse_qid_number(value: &str, line_number: usize) -> Result<u32> {
    let digits = value
        .strip_prefix('Q')
        .ok_or_else(|| CliError(format!("invalid QID `{value}` at line {line_number}")))?;
    digits.parse::<u32>().map_err(|err| {
        CliError(format!(
            "QID `{value}` exceeds runtime u32 encoding at line {line_number}: {err}"
        ))
        .into()
    })
}

fn copy_exact_bytes<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    bytes: u64,
    label: &str,
) -> Result<()> {
    let copied = copy(&mut reader.take(bytes), writer)?;
    if copied == bytes {
        Ok(())
    } else {
        Err(CliError(format!("unexpected EOF while copying {label}")).into())
    }
}

fn read_u32<R: Read>(reader: &mut R) -> Result<u32> {
    let mut bytes = [0u8; 4];
    reader.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u8<R: Read>(reader: &mut R) -> Result<u8> {
    let mut bytes = [0u8; 1];
    reader.read_exact(&mut bytes)?;
    Ok(bytes[0])
}

fn write_u32<W: Write>(writer: &mut W, value: u32) -> Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

fn postprocess_tmp_dir(out: &Path) -> PathBuf {
    let file_name = out
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("runtime");
    out.with_file_name(format!("{file_name}.tmp"))
}

fn build_automaton_bytes(patterns: Vec<String>, mode: CompileMode) -> Result<Vec<u8>> {
    match mode {
        CompileMode::Charwise => {
            let entries = patterns
                .into_iter()
                .enumerate()
                .map(|(surface_id, pattern)| (pattern, checked_surface_id(surface_id)));
            let automaton = CharwiseDoubleArrayAhoCorasickBuilder::new()
                .build_with_values(entries)
                .map_err(|err| CliError(format!("failed to build charwise automaton: {err}")))?;
            Ok(automaton.serialize())
        }
        CompileMode::Bytewise => {
            let entries = patterns
                .into_iter()
                .enumerate()
                .map(|(surface_id, pattern)| {
                    (pattern.into_bytes(), checked_surface_id(surface_id))
                });
            let automaton = DoubleArrayAhoCorasickBuilder::new()
                .build_with_values(entries)
                .map_err(|err| CliError(format!("failed to build bytewise automaton: {err}")))?;
            Ok(automaton.serialize())
        }
    }
}

fn checked_surface_id(surface_id: usize) -> u32 {
    u32::try_from(surface_id).expect("surface_id overflowed u32")
}

fn compile_tmp_dir(out: &Path) -> PathBuf {
    let file_name = out
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("compile");
    out.with_file_name(format!("{file_name}.tmp"))
}

fn validate_surface_qids_header(line: &str) -> Result<()> {
    if line == "surface_key\tqids\tqid_count" {
        Ok(())
    } else {
        Err(CliError(format!("unexpected surface_qids.tsv header: {line}")).into())
    }
}

fn validate_entity_facts_header(line: &str) -> Result<()> {
    if line == "qid\tflags\tpredicate_pairs\tpredicate_count" {
        Ok(())
    } else {
        Err(CliError(format!("unexpected entity_facts.tsv header: {line}")).into())
    }
}

fn first_tsv_column(line: &str) -> Option<&str> {
    line.split_once('\t').map(|(first, _rest)| first)
}

fn unescape_tsv(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }
        match chars.next() {
            Some('\\') => output.push('\\'),
            Some('t') => output.push('\t'),
            Some('n') => output.push('\n'),
            Some('r') => output.push('\r'),
            Some(other) => {
                output.push('\\');
                output.push(other);
            }
            None => output.push('\\'),
        }
    }
    output
}

fn write_compile_progress(
    path: &Path,
    phase: &str,
    surface_count: usize,
    pattern_bytes: usize,
) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "phase\tsurface_count\tlast_surface_id\tpattern_bytes")?;
    let last_surface_id = surface_count
        .checked_sub(1)
        .map(|value| value.to_string())
        .unwrap_or_else(|| "-1".to_string());
    writeln!(
        file,
        "{}\t{}\t{}\t{}",
        phase, surface_count, last_surface_id, pattern_bytes
    )?;
    file.flush()?;
    Ok(())
}

fn write_compile_manifest(
    path: &Path,
    args: &CompileArgs,
    input_path: &Path,
    surface_count: usize,
    pattern_bytes: usize,
    automaton_size: u64,
) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "{{")?;
    writeln!(file, "  \"generated_at_unix\": {},", generated_at_unix())?;
    writeln!(file, "  \"mode\": \"{}\",", args.mode.as_str())?;
    writeln!(
        file,
        "  \"preprocess\": \"{}\",",
        escape_json(&path_for_manifest(&args.preprocess))
    )?;
    writeln!(
        file,
        "  \"input\": \"{}\",",
        escape_json(&path_for_manifest(input_path))
    )?;
    writeln!(
        file,
        "  \"out\": \"{}\",",
        escape_json(&path_for_manifest(&args.out))
    )?;
    match args.limit {
        Some(limit) => writeln!(file, "  \"limit\": {limit},")?,
        None => writeln!(file, "  \"limit\": null,")?,
    }
    writeln!(file, "  \"surface_count\": {surface_count},")?;
    writeln!(file, "  \"pattern_bytes\": {pattern_bytes},")?;
    writeln!(file, "  \"automaton_bytes\": {automaton_size},")?;
    writeln!(file, "  \"files\": [")?;
    writeln!(file, "    \"automaton.bin\",")?;
    writeln!(file, "    \"manifest.json\",")?;
    writeln!(file, "    \"progress.tsv\"")?;
    writeln!(file, "  ]")?;
    writeln!(file, "}}")?;
    Ok(())
}

fn dump_path(dumps: &Path, wiki: &str, date: &str, component: &str) -> PathBuf {
    dumps
        .join(wiki)
        .join(date)
        .join(format!("{wiki}-{date}-{component}.sql.gz"))
}

fn wikidata_entities_dump_path(dumps: &Path, date: &str) -> PathBuf {
    let file_name = if date == "latest" {
        "latest-all.json.bz2".to_string()
    } else {
        format!("wikidata-{date}-all.json.bz2")
    };
    dumps.join("wikidatawiki").join(date).join(file_name)
}

fn read_pages(path: &Path, limit: Option<usize>) -> Result<HashMap<u64, Page>> {
    let mut pages = HashMap::new();
    for_insert_values(path, "page", limit, |fields| {
        if fields.len() < 4 {
            return Ok(());
        }
        let page_id = parse_u64(&fields[0])?;
        let namespace = parse_i32(&fields[1])?;
        if namespace != 0 {
            return Ok(());
        }
        let title = fields[2].clone();
        pages.insert(page_id, Page { title, qid: None });
        Ok(())
    })?;
    Ok(pages)
}

fn attach_page_qids(
    path: &Path,
    pages: &mut HashMap<u64, Page>,
    limit: Option<usize>,
) -> Result<usize> {
    let mut qid_count = 0;
    for_insert_values(path, "page_props", limit, |fields| {
        if fields.len() < 3 {
            return Ok(());
        }
        if fields[1] != "wikibase_item" {
            return Ok(());
        }
        let page_id = parse_u64(&fields[0])?;
        if let Some(page) = pages.get_mut(&page_id) {
            if page.qid.is_none() {
                qid_count += 1;
            }
            page.qid = Some(fields[2].clone());
        }
        Ok(())
    })?;
    Ok(qid_count)
}

fn read_redirects(
    wiki: &str,
    path: &Path,
    pages: &HashMap<u64, Page>,
    limit: Option<usize>,
) -> Result<Vec<SurfaceRow>> {
    let mut title_to_page_id = HashMap::with_capacity(pages.len());
    for (page_id, page) in pages {
        title_to_page_id.insert(page.title.as_str(), *page_id);
    }

    let mut redirects = Vec::new();
    for_insert_values(path, "redirect", limit, |fields| {
        if fields.len() < 3 {
            return Ok(());
        }
        let source_page_id = parse_u64(&fields[0])?;
        let namespace = parse_i32(&fields[1])?;
        if namespace != 0 {
            return Ok(());
        }
        let target_title = &fields[2];
        let Some(source_page) = pages.get(&source_page_id) else {
            return Ok(());
        };
        let Some(target_page_id) = title_to_page_id.get(target_title.as_str()) else {
            return Ok(());
        };
        let Some(target_page) = pages.get(target_page_id) else {
            return Ok(());
        };
        let Some(qid) = &target_page.qid else {
            return Ok(());
        };

        redirects.push(SurfaceRow {
            wiki: wiki.to_string(),
            surface_key: normalize_surface_key(&source_page.title),
            surface_text: title_to_surface_text(&source_page.title),
            qid: qid.clone(),
            source: "redirect",
            page_id: source_page_id,
            target_page_id: *target_page_id,
        });
        Ok(())
    })?;

    Ok(redirects)
}

fn build_surface_rows(
    wiki: &str,
    pages: &HashMap<u64, Page>,
    redirects: &[SurfaceRow],
) -> Vec<SurfaceRow> {
    let mut rows = Vec::new();

    for (page_id, page) in pages {
        if let Some(qid) = &page.qid {
            let surface_key = normalize_surface_key(&page.title);
            if surface_key.is_empty() {
                continue;
            }
            rows.push(SurfaceRow {
                wiki: wiki.to_string(),
                surface_key,
                surface_text: title_to_surface_text(&page.title),
                qid: qid.clone(),
                source: "page_title",
                page_id: *page_id,
                target_page_id: *page_id,
            });
        }
    }
    rows.extend(redirects.iter().map(|row| SurfaceRow {
        wiki: row.wiki.clone(),
        surface_key: row.surface_key.clone(),
        surface_text: row.surface_text.clone(),
        qid: row.qid.clone(),
        source: row.source,
        page_id: row.page_id,
        target_page_id: row.target_page_id,
    }));

    rows.sort_by(|a, b| {
        a.surface_key
            .cmp(&b.surface_key)
            .then_with(|| a.qid.cmp(&b.qid))
            .then_with(|| a.wiki.cmp(&b.wiki))
            .then_with(|| a.source.cmp(b.source))
    });

    let mut unique_rows = Vec::with_capacity(rows.len());
    let mut unique_seen = HashSet::<String>::new();
    for row in rows {
        let key = format!(
            "{}\t{}\t{}\t{}\t{}",
            row.wiki, row.surface_key, row.qid, row.source, row.page_id
        );
        if !row.surface_key.is_empty() && unique_seen.insert(key) {
            unique_rows.push(row);
        }
    }

    unique_rows
}

fn build_surface_qid_lists(rows: &[SurfaceRow]) -> Vec<(String, Vec<String>)> {
    let mut by_surface = HashMap::<String, HashSet<String>>::new();
    for row in rows {
        by_surface
            .entry(row.surface_key.clone())
            .or_default()
            .insert(row.qid.clone());
    }

    let mut result = by_surface
        .into_iter()
        .map(|(surface_key, qids)| {
            let mut qids = qids.into_iter().collect::<Vec<_>>();
            qids.sort();
            (surface_key, qids)
        })
        .collect::<Vec<_>>();
    result.sort_by(|a, b| a.0.cmp(&b.0));
    result
}

fn collect_surface_qid_numbers(rows: &[(String, Vec<String>)]) -> Result<HashSet<u32>> {
    let mut qids = HashSet::new();
    for (_surface_key, surface_qids) in rows {
        for qid in surface_qids {
            qids.insert(parse_qid_number(qid, 0)?);
        }
    }
    Ok(qids)
}

fn count_ambiguous_surfaces(surface_qids: &[(String, Vec<String>)]) -> usize {
    surface_qids
        .iter()
        .filter(|(_surface_key, qids)| qids.len() > 1)
        .count()
}

fn read_wikidata_entity_facts(
    dumps: &Path,
    date: &str,
    qids: &HashSet<u32>,
    limit: Option<usize>,
) -> Result<HashMap<u32, EntityFact>> {
    let mut facts = qids
        .iter()
        .copied()
        .map(|qid| (qid, EntityFact::default()))
        .collect::<HashMap<_, _>>();
    let path = wikidata_entities_dump_path(dumps, date);
    if !path.exists() {
        eprintln!(
            "missing Wikidata entities dump {}; writing empty entity facts",
            path.display()
        );
        return Ok(facts);
    }

    let mut handled = 0usize;
    let reader = open_wikidata_entities_reader(&path)?;
    for line in reader.lines() {
        let line = line?;
        let line = line.trim().trim_end_matches(',');
        if line.is_empty() || line == "[" || line == "]" {
            continue;
        }
        let entity = serde_json::from_str::<Value>(line)?;
        let Some(qid) = entity
            .get("id")
            .and_then(Value::as_str)
            .and_then(qid_number_from_str)
        else {
            continue;
        };
        if !qids.contains(&qid) {
            continue;
        }
        let fact = extract_entity_fact(&entity);
        facts.insert(qid, fact);
        handled += 1;
        if let Some(limit) = limit {
            if handled >= limit {
                break;
            }
        }
    }
    Ok(facts)
}

fn open_wikidata_entities_reader(path: &Path) -> Result<Box<dyn BufRead>> {
    if path.extension().and_then(|ext| ext.to_str()) == Some("bz2") {
        let mut child = Command::new("bzip2")
            .arg("-dc")
            .arg(path)
            .stdout(Stdio::piped())
            .spawn()?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CliError("failed to read bzip2 stdout".to_string()))?;
        return Ok(Box::new(BufReader::new(stdout)));
    }
    Ok(Box::new(BufReader::new(File::open(path)?)))
}

fn extract_entity_fact(entity: &Value) -> EntityFact {
    let mut predicates = HashSet::<(u32, u32)>::new();
    if let Some(claims) = entity.get("claims").and_then(Value::as_object) {
        for (pid, claims) in claims {
            let Some(pid) = pid_number_from_str(pid) else {
                continue;
            };
            let Some(claims) = claims.as_array() else {
                continue;
            };
            for claim in claims {
                let value_qid = claim_value_qid(claim).unwrap_or(0);
                predicates.insert((pid, value_qid));
            }
        }
    }
    let mut predicates = predicates.into_iter().collect::<Vec<_>>();
    predicates.sort_unstable();
    let flags = if predicates
        .iter()
        .any(|&(pid, value_qid)| pid == 31 && value_qid == WIKIDATA_DISAMBIGUATION_QID)
    {
        ENTITY_FLAG_DISAMBIGUATION
    } else {
        0
    };
    EntityFact { flags, predicates }
}

fn claim_value_qid(claim: &Value) -> Option<u32> {
    claim
        .get("mainsnak")?
        .get("datavalue")?
        .get("value")?
        .get("id")
        .and_then(Value::as_str)
        .and_then(qid_number_from_str)
}

fn qid_number_from_str(value: &str) -> Option<u32> {
    value.strip_prefix('Q')?.parse::<u32>().ok()
}

fn pid_number_from_str(value: &str) -> Option<u32> {
    value.strip_prefix('P')?.parse::<u32>().ok()
}

fn for_insert_values<F>(
    path: &Path,
    table_name: &str,
    limit: Option<usize>,
    mut handle: F,
) -> Result<()>
where
    F: FnMut(Vec<String>) -> Result<()>,
{
    if !path.exists() {
        return Err(CliError(format!("missing dump file: {}", path.display())).into());
    }

    let mut child = Command::new("gzip")
        .arg("-dc")
        .arg(path)
        .stdout(Stdio::piped())
        .spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CliError("failed to read gzip stdout".to_string()))?;
    let reader = BufReader::new(stdout);
    let insert_prefix = format!("INSERT INTO `{table_name}` VALUES ");
    let mut handled = 0usize;

    for line in reader.split(b'\n') {
        let line = line?;
        let line = String::from_utf8_lossy(&line);
        if !line.starts_with(&insert_prefix) {
            continue;
        }
        let values = line
            .strip_prefix(&insert_prefix)
            .unwrap_or(&line)
            .trim_end_matches(';');

        parse_insert_tuples(values, |fields| {
            if let Some(limit) = limit {
                if handled >= limit {
                    return Ok(());
                }
            }
            handle(fields)?;
            handled += 1;
            Ok(())
        })?;
    }

    let status = child.wait()?;
    if !status.success() {
        return Err(CliError(format!("gzip failed for {}", path.display())).into());
    }

    Ok(())
}

fn parse_insert_tuples<F>(input: &str, mut handle: F) -> Result<()>
where
    F: FnMut(Vec<String>) -> Result<()>,
{
    let bytes = input.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        while index < bytes.len() && (bytes[index] == b',' || bytes[index].is_ascii_whitespace()) {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        if bytes[index] != b'(' {
            return Err(CliError(format!("expected tuple at byte {index}")).into());
        }
        index += 1;

        let mut fields = Vec::new();
        let mut current = Vec::<u8>::new();
        let mut in_string = false;
        let mut is_null = false;

        while index < bytes.len() {
            let byte = bytes[index];
            if in_string {
                match byte {
                    b'\\' => {
                        index += 1;
                        if index >= bytes.len() {
                            break;
                        }
                        current.push(mysql_unescape_byte(bytes[index]));
                    }
                    b'\'' => in_string = false,
                    _ => current.push(byte),
                }
                index += 1;
                continue;
            }

            match byte {
                b'\'' => {
                    in_string = true;
                    index += 1;
                }
                b',' => {
                    fields.push(if is_null {
                        String::new()
                    } else {
                        field_to_string(&current)
                    });
                    current.clear();
                    is_null = false;
                    index += 1;
                }
                b')' => {
                    fields.push(if is_null {
                        String::new()
                    } else {
                        field_to_string(&current)
                    });
                    handle(fields)?;
                    index += 1;
                    break;
                }
                b'N' if input[index..].starts_with("NULL") => {
                    is_null = true;
                    index += 4;
                }
                _ => {
                    current.push(byte);
                    index += 1;
                }
            }
        }
    }

    Ok(())
}

fn mysql_unescape_byte(byte: u8) -> u8 {
    match byte {
        b'0' => b'\0',
        b'\'' => b'\'',
        b'"' => b'"',
        b'b' => 0x08,
        b'n' => b'\n',
        b'r' => b'\r',
        b't' => b'\t',
        b'Z' => 0x1a,
        b'\\' => b'\\',
        other => other,
    }
}

fn field_to_string(value: &[u8]) -> String {
    let trimmed = trim_ascii(value);
    String::from_utf8_lossy(trimmed).into_owned()
}

fn trim_ascii(value: &[u8]) -> &[u8] {
    let mut start = 0;
    let mut end = value.len();
    while start < end && value[start].is_ascii_whitespace() {
        start += 1;
    }
    while end > start && value[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    &value[start..end]
}

fn parse_u64(value: &str) -> Result<u64> {
    value
        .parse::<u64>()
        .map_err(|err| CliError(format!("expected u64 `{value}`: {err}")).into())
}

fn parse_i32(value: &str) -> Result<i32> {
    value
        .parse::<i32>()
        .map_err(|err| CliError(format!("expected i32 `{value}`: {err}")).into())
}

fn normalize_surface_key(title: &str) -> String {
    title_to_surface_text(title).trim().to_string()
}

fn title_to_surface_text(title: &str) -> String {
    title.replace('_', " ")
}

fn write_surface_sources_tsv(path: &Path, rows: &[SurfaceRow]) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(
        file,
        "surface_key\tsurface_text\tqid\twiki\tsource\tpage_id\ttarget_page_id"
    )?;
    for row in rows {
        writeln!(
            file,
            "{}\t{}\t{}\t{}\t{}\t{}\t{}",
            escape_tsv(&row.surface_key),
            escape_tsv(&row.surface_text),
            escape_tsv(&row.qid),
            escape_tsv(&row.wiki),
            row.source,
            row.page_id,
            row.target_page_id
        )?;
    }
    Ok(())
}

fn write_surface_qid_lists_tsv(path: &Path, rows: &[(String, Vec<String>)]) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "surface_key\tqids\tqid_count")?;
    for (surface_key, qids) in rows {
        writeln!(
            file,
            "{}\t{}\t{}",
            escape_tsv(surface_key),
            escape_tsv(&qids.join("|")),
            qids.len()
        )?;
    }
    Ok(())
}

fn write_entity_facts_tsv(
    path: &Path,
    qids: &HashSet<u32>,
    facts: &HashMap<u32, EntityFact>,
) -> Result<()> {
    let mut file = File::create(path)?;
    let mut qids = qids.iter().copied().collect::<Vec<_>>();
    qids.sort_unstable();
    writeln!(file, "qid\tflags\tpredicate_pairs\tpredicate_count")?;
    for qid in qids {
        let fact = facts.get(&qid).cloned().unwrap_or_default();
        let pairs = fact
            .predicates
            .iter()
            .map(|(pid, value_qid)| {
                if *value_qid == 0 {
                    format!("P{pid}=")
                } else {
                    format!("P{pid}=Q{value_qid}")
                }
            })
            .collect::<Vec<_>>();
        writeln!(
            file,
            "Q{qid}\t{}\t{}\t{}",
            fact.flags,
            escape_tsv(&pairs.join("|")),
            pairs.len()
        )?;
    }
    Ok(())
}

fn write_preprocess_manifest(path: &Path, args: &ProcessArgs, summaries: &[String]) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "{{")?;
    writeln!(file, "  \"generated_at_unix\": {},", generated_at_unix())?;
    writeln!(file, "  \"date\": \"{}\",", escape_json(&args.date))?;
    writeln!(
        file,
        "  \"dumps\": \"{}\",",
        escape_json(&path_for_manifest(&args.dumps))
    )?;
    writeln!(
        file,
        "  \"out\": \"{}\",",
        escape_json(&path_for_manifest(&args.out))
    )?;
    writeln!(file, "  \"wikis\": [")?;
    for (index, wiki) in args.wikis.iter().enumerate() {
        let comma = if index + 1 == args.wikis.len() {
            ""
        } else {
            ","
        };
        writeln!(file, "    \"{}\"{comma}", escape_json(wiki))?;
    }
    writeln!(file, "  ],")?;
    writeln!(file, "  \"files\": [")?;
    writeln!(file, "    \"surface_qids.tsv\",")?;
    writeln!(file, "    \"surface_sources.tsv\",")?;
    writeln!(file, "    \"entity_facts.tsv\"")?;
    writeln!(file, "  ],")?;
    writeln!(file, "  \"summaries\": [")?;
    for (index, summary) in summaries.iter().enumerate() {
        let comma = if index + 1 == summaries.len() {
            ""
        } else {
            ","
        };
        writeln!(file, "    \"{}\"{comma}", escape_json(summary))?;
    }
    writeln!(file, "  ]")?;
    writeln!(file, "}}")?;
    Ok(())
}

fn escape_tsv(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\t', "\\t")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn build_targets(args: &DownloadArgs) -> Result<Vec<DownloadTarget>> {
    let mut targets = Vec::new();

    for component in &args.components {
        match component {
            Component::Page | Component::Redirect | Component::PageProps => {
                for wiki in &args.wikis {
                    if wiki.trim().is_empty() {
                        return Err(CliError("wiki names must not be empty".to_string()).into());
                    }
                    targets.push(wikipedia_sql_target(
                        &args.out,
                        wiki,
                        args.date.as_str(),
                        *component,
                    )?);
                }
            }
            Component::WikidataEntities => {
                targets.push(wikidata_entities_target(&args.out, args.date.as_str()));
            }
        }
    }

    Ok(targets)
}

fn wikipedia_sql_target(
    out: &Path,
    wiki: &str,
    date: &str,
    component: Component,
) -> Result<DownloadTarget> {
    let dump_name = match component {
        Component::Page => "page",
        Component::Redirect => "redirect",
        Component::PageProps => "page_props",
        Component::WikidataEntities => {
            return Err(
                CliError("wikidata_entities is not a Wikipedia SQL component".to_string()).into(),
            )
        }
    };
    let file_name = format!("{wiki}-{date}-{dump_name}.sql.gz");
    let url = format!("{WIKIMEDIA_DUMPS_BASE}/{wiki}/{date}/{file_name}");
    let path = out.join(wiki).join(date).join(file_name);

    Ok(DownloadTarget {
        component,
        wiki: Some(wiki.to_string()),
        url,
        path,
    })
}

fn wikidata_entities_target(out: &Path, date: &str) -> DownloadTarget {
    let (url, file_name) = if date == "latest" {
        (
            format!("{WIKIMEDIA_DUMPS_BASE}/wikidatawiki/entities/latest-all.json.bz2"),
            "latest-all.json.bz2".to_string(),
        )
    } else {
        (
            format!(
                "{WIKIMEDIA_DUMPS_BASE}/wikidatawiki/entities/{date}/wikidata-{date}-all.json.bz2"
            ),
            format!("wikidata-{date}-all.json.bz2"),
        )
    };
    let path = out.join("wikidatawiki").join(date).join(file_name);

    DownloadTarget {
        component: Component::WikidataEntities,
        wiki: None,
        url,
        path,
    }
}

fn download_target(target: &DownloadTarget, user_agent: &str, force: bool) -> Result<()> {
    if let Some(parent) = target.path.parent() {
        fs::create_dir_all(parent)?;
    }

    if target.path.exists() && !force {
        eprintln!("exists {}, skipping", target.path.display());
        return Ok(());
    }

    if force && target.path.exists() {
        fs::remove_file(&target.path)?;
    }

    let partial_path = partial_path(&target.path);
    let mut curl = Command::new("curl");
    curl.arg("--fail")
        .arg("--location")
        .arg("--retry")
        .arg("3")
        .arg("--retry-delay")
        .arg("2")
        .arg("--user-agent")
        .arg(user_agent)
        .arg("--output")
        .arg(&partial_path);

    if partial_path.exists() {
        curl.arg("--continue-at").arg("-");
    }

    curl.arg(&target.url);

    eprintln!("downloading {}", target.url);
    let status = curl.status()?;
    if !status.success() {
        return Err(CliError(format!("curl failed for {}", target.url)).into());
    }

    fs::rename(&partial_path, &target.path)?;
    let bytes = target.path.metadata()?.len();
    eprintln!("wrote {} ({bytes} bytes)", target.path.display());

    Ok(())
}

fn require_curl() -> Result<()> {
    let status = Command::new("curl")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err(CliError("curl is required for downloads".to_string()).into()),
    }
}

fn require_gzip() -> Result<()> {
    let status = Command::new("gzip")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err(CliError("gzip is required for processing dumps".to_string()).into()),
    }
}

fn partial_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("download");
    path.with_file_name(format!("{file_name}.part"))
}

fn write_manifest(path: &Path, date: &str, targets: &[DownloadTarget]) -> Result<()> {
    let mut file = File::create(path)?;
    writeln!(file, "{{")?;
    writeln!(file, "  \"generated_at_unix\": {},", generated_at_unix())?;
    writeln!(file, "  \"date\": \"{}\",", escape_json(date))?;
    writeln!(file, "  \"files\": [")?;

    for (index, target) in targets.iter().enumerate() {
        let comma = if index + 1 == targets.len() { "" } else { "," };
        let bytes = target.path.metadata().map(|metadata| metadata.len()).ok();
        writeln!(file, "    {{")?;
        writeln!(
            file,
            "      \"component\": \"{}\",",
            target.component.as_str()
        )?;
        match &target.wiki {
            Some(wiki) => writeln!(file, "      \"wiki\": \"{}\",", escape_json(wiki))?,
            None => writeln!(file, "      \"wiki\": null,")?,
        }
        writeln!(file, "      \"url\": \"{}\",", escape_json(&target.url))?;
        writeln!(
            file,
            "      \"path\": \"{}\",",
            escape_json(&path_for_manifest(&target.path))
        )?;
        match bytes {
            Some(bytes) => writeln!(file, "      \"bytes\": {bytes}")?,
            None => writeln!(file, "      \"bytes\": null")?,
        }
        writeln!(file, "    }}{comma}")?;
    }

    writeln!(file, "  ]")?;
    writeln!(file, "}}")?;
    Ok(())
}

fn path_for_manifest(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn validate_date(date: &str) -> Result<()> {
    if date == "latest" {
        return Ok(());
    }
    let valid = date.len() == 8 && date.bytes().all(|byte| byte.is_ascii_digit());
    if !valid {
        return Err(CliError(format!("date must be latest or YYYYMMDD, got {date}")).into());
    }
    Ok(())
}

fn generated_at_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn escape_json(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            ch if ch.is_control() => escaped.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => escaped.push(ch),
        }
    }
    escaped
}

fn print_help() {
    println!("wikipage-spine-dataset-builder");
    println!();
    println!("Commands:");
    println!("  download    Download upstream Wikimedia dump files");
    println!("  preprocess  Extract surface_key -> QID[] rows from downloaded dumps");
    println!("  compile     Compile surface keys into an Aho-Corasick automaton");
    println!("  postprocess Build JavaScript runtime tables from compiled data");
    println!();
    println!("Run `wikipage-spine-dataset-builder download --help` for download options.");
}

fn print_download_help() {
    println!("Usage:");
    println!("  wikipage-spine-dataset-builder download [options]");
    println!();
    println!("Options:");
    println!("  --out <dir>                  Output directory (default: crates/data/dumps)");
    println!("  --wikis <csv>                Wiki DB names (default: zhwiki,enwiki)");
    println!("  --components <csv>           page,redirect,page_props,wikidata_entities");
    println!("                               default: page,redirect,page_props");
    println!("  --date <latest|YYYYMMDD>     Dump date (default: latest)");
    println!("  --user-agent <value>         User-Agent for Wikimedia downloads");
    println!("  --dry-run                    Print URLs without downloading");
    println!("  --force                      Redownload existing final files");
}

fn print_process_help() {
    println!("Usage:");
    println!("  wikipage-spine-dataset-builder preprocess [options]");
    println!();
    println!("Options:");
    println!(
        "  --dumps <dir>                Downloaded dump directory (default: crates/data/dumps)"
    );
    println!("  --out <dir>                  Output directory (default: crates/data/preprocess)");
    println!("  --wikis <csv>                Wiki DB names (default: zhwiki,enwiki)");
    println!("  --date <latest|YYYYMMDD>     Dump date (default: latest)");
    println!("  --limit <n>                  Debug limit for parsed INSERT tuples per table");
}

fn print_compile_help() {
    println!("Usage:");
    println!("  wikipage-spine-dataset-builder compile [options]");
    println!();
    println!("Options:");
    println!(
        "  --preprocess <dir>           Preprocess directory (default: crates/data/preprocess)"
    );
    println!("  --out <dir>                  Output directory (default: crates/data/compile)");
    println!("  --mode <charwise|bytewise>   Daachorse automaton mode (default: charwise)");
    println!("  --limit <n>                  Debug limit for surface rows");
    println!("  --progress-every <n>         Progress interval (default: 100000)");
}

fn print_postprocess_help() {
    println!("Usage:");
    println!("  wikipage-spine-dataset-builder postprocess [options]");
    println!();
    println!("Options:");
    println!(
        "  --preprocess <dir>           Preprocess directory (default: crates/data/preprocess)"
    );
    println!("  --compile <dir>              Compile directory (default: crates/data/compile)");
    println!("  --out <dir>                  Output directory (default: crates/data/runtime)");
    println!("  --progress-every <n>         Progress interval (default: 100000)");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compact_ac::{CharwiseDoubleArrayAhoCorasick, DoubleArrayAhoCorasick};

    #[test]
    fn charwise_automaton_preserves_surface_ids_after_serialize() {
        let bytes = build_automaton_bytes(
            vec![
                "北京".to_string(),
                "北京大学".to_string(),
                "大学".to_string(),
            ],
            CompileMode::Charwise,
        )
        .unwrap();
        let (automaton, rest) = CharwiseDoubleArrayAhoCorasick::<u32>::deserialize(&bytes).unwrap();
        assert!(rest.is_empty());

        let hits = automaton
            .find_overlapping_iter("我在北京大学")
            .map(|m| (m.start(), m.end(), m.value()))
            .collect::<Vec<_>>();

        assert_eq!(hits, vec![(6, 12, 0), (6, 18, 1), (12, 18, 2)]);
    }

    #[test]
    fn bytewise_automaton_preserves_surface_ids_after_serialize() {
        let bytes = build_automaton_bytes(
            vec!["bcd".to_string(), "ab".to_string(), "a".to_string()],
            CompileMode::Bytewise,
        )
        .unwrap();
        let (automaton, rest) = DoubleArrayAhoCorasick::<u32>::deserialize(&bytes).unwrap();
        assert!(rest.is_empty());

        let hits = automaton
            .find_overlapping_iter("abcd")
            .map(|m| (m.start(), m.end(), m.value()))
            .collect::<Vec<_>>();

        assert_eq!(hits, vec![(0, 1, 2), (0, 2, 1), (1, 4, 0)]);
    }

    #[test]
    fn postprocess_writes_runtime_entity_and_output_tables() {
        let root = std::env::temp_dir().join(format!(
            "wikipage-spine-postprocess-test-{}-{}",
            std::process::id(),
            generated_at_unix()
        ));
        let preprocess_dir = root.join("preprocess");
        let compile_dir = root.join("compile");
        let runtime_dir = root.join("runtime");
        fs::create_dir_all(&preprocess_dir).unwrap();
        fs::create_dir_all(&compile_dir).unwrap();

        fs::write(
            preprocess_dir.join("surface_qids.tsv"),
            "surface_key\tqids\tqid_count\n北京\tQ956\t1\n北京大学\tQ13371|Q3918\t2\n大学\tQ3918\t1\n",
        )
        .unwrap();
        fs::write(
            preprocess_dir.join("entity_facts.tsv"),
            "qid\tflags\tpredicate_pairs\tpredicate_count\nQ956\t0\tP31=Q515|P17=Q148\t2\nQ3918\t0\tP31=Q875538\t1\nQ13371\t1\tP31=Q4167410\t1\n",
        )
        .unwrap();
        let automaton = build_automaton_bytes(
            vec![
                "北京".to_string(),
                "北京大学".to_string(),
                "大学".to_string(),
            ],
            CompileMode::Charwise,
        )
        .unwrap();
        fs::write(compile_dir.join("automaton.bin"), automaton).unwrap();

        postprocess(PostprocessArgs {
            preprocess: preprocess_dir,
            compile: compile_dir,
            out: runtime_dir.clone(),
            progress_every: 1,
        })
        .unwrap();

        let surface_eid_index =
            fs::read(runtime_dir.join("surfaces/surface_eid_index.bin")).unwrap();
        assert_eq!(read_u32_at(&surface_eid_index, 0), 0);
        assert_eq!(read_u32_at(&surface_eid_index, 4), 1);
        assert_eq!(read_u32_at(&surface_eid_index, 8), 1);
        assert_eq!(read_u32_at(&surface_eid_index, 12), 2);
        assert_eq!(read_u32_at(&surface_eid_index, 16), 3);
        assert_eq!(read_u32_at(&surface_eid_index, 20), 1);

        let surface_eid_values =
            fs::read(runtime_dir.join("surfaces/surface_eid_values.bin")).unwrap();
        let surface_eid_values = surface_eid_values
            .chunks_exact(4)
            .map(|chunk| u32::from_le_bytes(chunk.try_into().unwrap()))
            .collect::<Vec<_>>();
        assert_eq!(surface_eid_values, vec![0, 2, 1, 1]);

        let eid_qids = fs::read(runtime_dir.join("eids/qid_numbers.bin")).unwrap();
        let eid_qids = eid_qids
            .chunks_exact(4)
            .map(|chunk| u32::from_le_bytes(chunk.try_into().unwrap()))
            .collect::<Vec<_>>();
        assert_eq!(eid_qids, vec![956, 3918, 13371]);

        let eid_flags = fs::read(runtime_dir.join("eids/flags.bin")).unwrap();
        assert_eq!(read_u32_at(&eid_flags, 0), 0);
        assert_eq!(read_u32_at(&eid_flags, 4), 0);
        assert_eq!(read_u32_at(&eid_flags, 8), ENTITY_FLAG_DISAMBIGUATION);

        let predicate_index = fs::read(runtime_dir.join("eids/predicate_index.bin")).unwrap();
        assert_eq!(read_u32_at(&predicate_index, 0), 0);
        assert_eq!(read_u32_at(&predicate_index, 4), 2);
        assert_eq!(read_u32_at(&predicate_index, 8), 2);
        assert_eq!(read_u32_at(&predicate_index, 12), 1);
        assert_eq!(read_u32_at(&predicate_index, 16), 3);
        assert_eq!(read_u32_at(&predicate_index, 20), 1);

        let state_outputs = fs::read(runtime_dir.join("automaton/state_outputs.bin")).unwrap();
        let outputs = state_outputs
            .chunks_exact(12)
            .map(|chunk| {
                (
                    u32::from_le_bytes(chunk[0..4].try_into().unwrap()),
                    u32::from_le_bytes(chunk[4..8].try_into().unwrap()),
                    u32::from_le_bytes(chunk[8..12].try_into().unwrap()),
                )
            })
            .collect::<Vec<_>>();
        assert!(outputs.contains(&(0, 2, 0)));
        assert!(outputs.iter().any(|&(id, len, _)| id == 1 && len == 4));
        assert!(outputs.iter().any(|&(id, len, _)| id == 2 && len == 2));

        fs::remove_dir_all(root).unwrap();
    }

    fn read_u32_at(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }
}
