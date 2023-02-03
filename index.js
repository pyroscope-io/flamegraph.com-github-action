const core = require("@actions/core");
const httpm = require("@actions/http-client");
const github = require("@actions/github");
const fs = require("fs").promises;
const { SUMMARY_ENV_VAR } = require("@actions/core/lib/summary");
const { promisify } = require("util");
const g = require("glob");
const glob = promisify(g);
const path = require("path");

const http = new httpm.HttpClient("");

async function findFiles() {
  return glob(core.getInput("file"));
}

async function upload(filepath) {
  const file = await fs.readFile(filepath, { encoding: "base64" });

  const baseUrl = "https://www.flamegraph.com";

  const data = {
    filename: filepath,
    name: filepath,
    profile: file,
  };

  const res = await http.postJson(`${baseUrl}/api/upload/v1`, {
    ...data,
  });

  return { url: res.result.url, key: res.result.key };
}

function NewSummary() {
  // TODO: summary is disabled in act?
  // create a proxy to debug if commands were called correctly
  if (!process.env[SUMMARY_ENV_VAR]) {
    const handler = {
      get(target, prop, receiver) {
        if (typeof target[prop] === "function") {
          // Noop
          return (...args) => {
            console.log(`${prop}`, { args });
            return receiver;
          };
        }
        return null;
      },
    };
    return new Proxy(core.summary, handler);
  }

  return core.summary;
}

async function buildSummary(files) {
  const Summary = NewSummary();

  for (const f of files) {
    Summary.addHeading(f.filepath, 4)
      .addLink("View Run in Flamegraph.com", f.url)
      .addBreak()
      .addRaw(
        `<a href="${f.url}" target="_blank"><img src="https://flamegraph.com/api/preview/${f.key}" /></a>`
      )
      .addSeparator();
  }
  await Summary.write();
}
function getToken() {
  return core.getInput("token");
}

async function findPreviousComment(magicString, repo, issueNumber) {
  // TODO: receive octokit as a dependency
  const octokit = github.getOctokit(getToken());

  // TODO: handle pagination
  const { data: comments } = await octokit.rest.issues.listComments({
    ...repo,
    issue_number: issueNumber,
  });

  return comments.find((comment) => comment.body?.includes(magicString));
}

async function postInBody(files, ctx) {
  const prNumber = ctx.payload.pull_request.number;
  const octokit = github.getOctokit(getToken());

  const magicString =
    'Created by <a href="https://github.com/pyroscope-io/flamegraph.com-github-action">Flamegraph.com Github Action</a>';

  // target="_blank" doesn't seem to work
  // https://stackoverflow.com/questions/41915571/open-link-in-new-tab-with-github-markdown-using-target-blank
  let message = files
    .map((f) => {
      return `<details>
          <summary>${path.basename(f.filepath)}</summary>
          <a href="${f.url}"><img src="https://flamegraph.com/api/preview/${
        f.key
      }" /></a>
          <br />
          <a href="${f.url}">See in flamegraph.co.key</a>
        </details>`;
    })
    .join("");

  message = `<h1>Flamegraph.com report</h1>` + message + `<br/>${magicString}`;

  const previousComment = await findPreviousComment(
    magicString,
    ctx.repo,
    prNumber
  );
  if (previousComment) {
    await octokit.rest.issues.updateComment({
      ...ctx.repo,
      comment_id: previousComment.id,
      issue_number: prNumber,
      body: message,
    });
    return;
  }

  await octokit.rest.issues.createComment({
    ...ctx.repo,
    issue_number: prNumber,
    body: message,
  });
}

async function run() {
  const files = (await findFiles()).map((a) => ({
    filepath: a,
  }));

  if (!files.length) {
    // TODO: maybe we should delete the existing comment
    return;
  }

  for (const file of files) {
    try {
      const res = await upload(file.filepath);
      file.url = res.url;
      file.key = res.key;
    } catch (error) {
      core.setFailed(error.message);
      return;
    }
  }

  await buildSummary(files);

  const context = github.context;
  const shouldPostInPRBody =
    core.getInput("postInPR") && context.payload.pull_request;

  if (shouldPostInPRBody) {
    await postInBody(files, context);
  }
}

run();
