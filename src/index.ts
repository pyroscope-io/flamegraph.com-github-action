import core from "@actions/core";
import httpm from "@actions/http-client";
import github from "@actions/github";
import { promises as fs } from "fs";
import { SUMMARY_ENV_VAR } from "@actions/core/lib/summary";
import { promisify } from "util";
import g from "glob";
import path from "path";

const glob = promisify(g);

const http = new httpm.HttpClient("");

async function findFiles() {
  return glob(core.getInput("file"));
}

function generateMagicString() {
  const id = core.getInput("id") || "1";
  return `<!-- flamegraph.com:${id} -->`;
}

async function upload(filepath: string) {
  const file = await fs.readFile(filepath, { encoding: "base64" });

  const baseUrl = "https://www.flamegraph.com";

  const data = {
    filename: filepath,
    name: filepath,
    profile: file,
  };

  const res = await http.postJson<{ url: string; key: string }>(
    `${baseUrl}/api/upload/v1`,
    {
      ...data,
    }
  );
  if (!res || !res.result) {
    throw new Error(
      `Error uploading a flamegraph. Response contains '${JSON.stringify(
        res.result
      )}'`
    );
  }

  return { url: res.result.url, key: res.result.key };
}

function NewSummary() {
  // TODO: summary is disabled in act?
  // create a proxy to debug if commands were called correctly
  if (!process.env[SUMMARY_ENV_VAR]) {
    const handler = {
      get(target: any, prop: any, receiver: any) {
        if (typeof target[prop] === "function") {
          // Noop
          return (...args: any[]) => {
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

type UploadedFlamegraph = {
  url: string;
  filepath: string;
  key: string;
};

async function buildSummary(files: UploadedFlamegraph[]) {
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

async function findPreviousComment(
  repo: typeof github.context.repo,
  issueNumber: typeof github.context.issue.number
) {
  // TODO: receive octokit as a dependency
  const octokit = github.getOctokit(getToken());
  const magicString = generateMagicString();

  // TODO: handle pagination
  const { data: comments } = await octokit.rest.issues.listComments({
    ...repo,
    issue_number: issueNumber,
  });

  return comments.find((comment) => comment.body?.includes(magicString));
}

async function postInBody(
  files: UploadedFlamegraph[],
  ctx: typeof github.context
) {
  if (!ctx.payload.pull_request) {
    throw new Error("Not a pull request");
  }
  const prNumber = ctx.payload.pull_request.number;
  const octokit = github.getOctokit(getToken());

  const magicString = generateMagicString();
  const footer =
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
          <a href="${f.url}">See in flamegraph.com</a>
        </details>`;
    })
    .join("");

  message =
    `<h1>Flamegraph.com report</h1>` + message + `<br/>${footer}${magicString}`;

  const previousComment = await findPreviousComment(ctx.repo, prNumber);
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

  const uploadedFlamegraphs: UploadedFlamegraph[] = [];
  for (const file of files) {
    try {
      const res = await upload(file.filepath);
      uploadedFlamegraphs.push({
        filepath: file.filepath,
        url: res.url,
        key: res.key,
      });
    } catch (error: unknown) {
      let errMessage =
        error instanceof Error
          ? error.message
          : `Error uploading flamegraph: ${error}`;

      core.setFailed(errMessage);
      return;
    }
  }

  await buildSummary(uploadedFlamegraphs);

  const context = github.context;

  const shouldPostInPRBody =
    core.getInput("postInPR") && context.payload.pull_request;

  if (shouldPostInPRBody) {
    await postInBody(uploadedFlamegraphs, context);
  }
}

run();
