// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_claude_code_trajectory.py
// and tests/unit/agents/installed/test_codex_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0),
// with tests/unit/agents/installed/test_opencode.py and test_opencode_v2.py at the same commit.
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Ported cases are named in the case tables.
// Changed from Harbor's original: only the item ids are Harbor's; the differences, reasons and omissions are ours.
import { expect } from "bun:test";
import { AssertionError } from "node:assert";
import { problems } from "../atif-schema.js";

// One entry per ported Harbor item our export differs from on purpose. Reason codes:
// R1 no reasoning_content (OpenRouter decoding) · R2 helpers nested, not flat · R3 no human
// prompt, no turn · R4 user text not normalized Harbor's way · R5a we write no files and
// results are text · R5b non-text blocks leave no marker · R6 tokens per turn, llm_call_count
// never written · R7 a call with no result keeps a marked observation entry · R8 no cost
// fields · R9 a Codex web_search_call loses its id · R10 a lone Codex subagent rollout keeps
// its own prompt as a step · R11 cache writes are kept per turn as
// cache_creation_input_tokens, with no cache_write_input_tokens and no session total · R12 a
// task notification after a finished turn is a turn of its own with an empty user message ·
// R13 OpenCode reasoning is not read · R14 a failed call says so in
// extra.tool_result_is_error, with its error text as content, not in extra.error · R15
// OpenCode call arguments are not read · R16 one agent name, opencode, for both OpenCode
// versions.
export const EXPECTED_DIFFERENCES = [
  { id: "claude: agent_steps_carry_llm_call_count", reason: "R6", kind: "not handled", note: "Agent Threads never writes llm_call_count; token totals go on the turn's last step." },
  { id: "claude: byte_faithful_property_across_inputs[0]", reason: "R3", kind: "by design", note: "An empty prompt makes no turn in Agent Threads." },
  { id: "claude: byte_faithful_property_across_inputs[4]", reason: "R4", kind: "not handled", note: "Agent Threads keeps the whitespace-only prompt; Harbor skips it." },
  { id: "claude: byte_faithful_property_across_inputs[5]", reason: "R4", kind: "not handled", note: "Agent Threads keeps the whitespace-only prompt; Harbor skips it." },
  { id: "claude: distinct_subagent_ids_survive_the_combined_timeline", reason: "R2", kind: "by design", note: "Agent Threads nests helper steps and links them from the launching call; Harbor flattens them." },
  { id: "claude: fallback_branch_stringifies_non_dict_shapes[0]", reason: "R5b", kind: "not handled", note: "Non-str, non-list user content leaves no marker and no turn; Harbor stringifies it." },
  { id: "claude: fallback_branch_stringifies_non_dict_shapes[1]", reason: "R5b", kind: "not handled", note: "A list of bare strings has no text block, so it leaves no marker and no turn; Harbor joins the strings." },
  { id: "claude: fallback_branch_stringifies_non_dict_shapes[2]", reason: "R5b", kind: "not handled", note: "A list of bare numbers has no text block, so it leaves no marker and no turn; Harbor joins their string forms." },
  { id: "claude: fallback_branch_stringifies_non_dict_shapes[3]", reason: "R5b", kind: "not handled", note: "Non-str, non-list user content leaves no marker and no turn; Harbor stringifies it." },
  { id: "claude: fallback_content_non_str_non_list_byte_faithful", reason: "R5b", kind: "not handled", note: "Non-str, non-list user content leaves no marker and no turn; Harbor stringifies it byte for byte." },
  { id: "claude: list_branch_interleaved_text_and_tool_result", reason: "R3", kind: "by design", note: "Without a human prompt the session exports no trajectory; Harbor still joins the interleaved texts." },
  { id: "claude: list_content_empty_and_whitespace_only_parts_filtered", reason: "R4", kind: "not handled", note: "Agent Threads joins the parts it keeps with blank lines instead of filtering to the one non-blank part." },
  { id: "claude: list_content_multiple_text_blocks_joined_verbatim", reason: "R4", kind: "not handled", note: "Agent Threads joins user text blocks with one newline; Harbor joins with two." },
  { id: "claude: list_content_non_text_non_tool_result_block_json_encoded", reason: "R5b", kind: "not handled", note: "Agent Threads records image metadata in extra.images but does not JSON-encode the image block into message." },
  { id: "claude: reported_cost_remains_authoritative", reason: "R8", kind: "not handled", note: "Agent Threads reads only the transcript and writes no cost, so the total_cost_usd in Harbor's run log (claude-code.txt) is not carried over. The step's estimated cost uses Harbor's mocked price table and is not ported." },
  { id: "claude: redacted_thinking_openrouter_payload_decoded_to_reasoning", reason: "R1", kind: "by design", note: "Agent Threads treats redacted_thinking as opaque; Harbor decodes OpenRouter's wrapper." },
  { id: "claude: string_content_empty_is_skipped", reason: "R3", kind: "by design", note: "An empty prompt makes no turn in Agent Threads, so the export prints no trajectory." },
  { id: "claude: string_content_whitespace_only_is_skipped", reason: "R4", kind: "not handled", note: "Agent Threads keeps a whitespace-only prompt verbatim; Harbor filters it out." },
  { id: "claude: stringify_uses_json_dumps_for_non_str", reason: "R5b", kind: "not handled", note: "Non-str, non-list user content leaves no marker and no turn; Harbor writes Python json.dumps of it." },
  { id: "claude: subagent_events_deduped_by_uuid_across_files", reason: "R2", kind: "by design", note: "The unnamed helper is read as its own transcript (extra.subagents_no_call_names) instead of flat sidechain steps." },
  { id: "claude: subagent_file_events_become_sidechain_steps", reason: "R2", kind: "by design", note: "The helper's steps nest under subagent_trajectories and link from the launching call; Harbor flattens them into the main steps." },
  { id: "claude: tool_use_without_result_renders_call_without_observation", reason: "R7", kind: "by design", note: "Agent Threads retains a marked observation for a call that has no result." },
  { id: "claude: verbatim_production_layout", reason: "R2", kind: "by design", note: "The unnamed helper lands in extra.subagents_no_call_names instead of flat sidechain steps." },
  { id: "codex: cache_write_usage_is_preserved_and_priced", reason: "R11", kind: "not handled", note: "The 600 cache-write tokens are kept on the step as cache_creation_input_tokens, not cache_write_input_tokens, and final_metrics has no total_cache_write_input_tokens. The cost assertions use Harbor's mocked price table and are not ported." },
  { id: "codex: codex_grandchild_is_nested_under_its_parent", reason: "R3", kind: "by design", note: "Listed only because the port adds a prompt step to each rollout (Agent Threads needs a prompt to start a turn): the child and grandchild keep those prompt steps; Harbor's hold only their work steps." },
  { id: "codex: codex_subagent_rollouts_use_atif_children_without_copied_history", reason: "R3", kind: "by design", note: "Listed because the port adds a prompt step to each child rollout (Agent Threads needs a prompt to start a turn): each child keeps that prompt step and its nickname lands in extra.agent_name; Harbor's child holds only its work step. The export also writes no total_cost_usd (R8)." },
  { id: "codex: codex_uses_active_turn_model_for_steps_and_pricing", reason: "R8", kind: "not handled", note: "Step models match, but Agent Threads writes no cost_usd anywhere." },
  { id: "codex: data_url_containing_a_url_is_not_treated_as_remote", reason: "R5a", kind: "not handled", note: "The image part leaves no [image omitted] marker in the tool output text; Harbor writes one." },
  { id: "codex: data_url_parameters_do_not_hide_the_media_type", reason: "R5a", kind: "by design", note: "Agent Threads writes no files; only the text part of the tool output survives." },
  { id: "codex: dict_output_that_is_not_a_string_is_kept_as_json[0]", reason: "R5a", kind: "not handled", note: "Tool output stays text and no tool_call_details metadata is written; Harbor keeps both." },
  { id: "codex: dict_output_that_is_not_a_string_is_kept_as_json[1]", reason: "R5a", kind: "not handled", note: "Tool output stays text and no tool_call_details metadata is written; Harbor keeps both." },
  { id: "codex: dict_output_that_is_not_a_string_is_kept_as_json[2]", reason: "R5a", kind: "not handled", note: "Tool output stays text and no tool_call_details metadata is written; Harbor keeps both." },
  { id: "codex: dict_output_that_is_not_a_string_is_kept_as_json[3]", reason: "R5a", kind: "not handled", note: "Tool output stays text and no tool_call_details metadata is written; Harbor keeps both." },
  { id: "codex: dict_output_that_is_not_a_string_is_kept_as_json[4]", reason: "R5a", kind: "not handled", note: "Tool output stays text and no tool_call_details metadata is written; Harbor keeps both." },
  { id: "codex: images_are_never_written_through_a_planted_symlink[0]", reason: "R5a", kind: "not handled", note: "Agent Threads writes no files, so nothing is written through the planted path; but the image leaves no [image omitted] marker in the tool output text, which Harbor writes." },
  { id: "codex: images_are_never_written_through_a_planted_symlink[1]", reason: "R5a", kind: "not handled", note: "Agent Threads writes no files, so nothing is written through the planted path; but the image leaves no [image omitted] marker in the tool output text, which Harbor writes." },
  { id: "codex: images_are_never_written_through_a_planted_symlink[2]", reason: "R5a", kind: "not handled", note: "Agent Threads writes no files, so nothing is written through the planted path; but the image leaves no [image omitted] marker in the tool output text, which Harbor writes." },
  { id: "codex: input_image_data_url_is_saved_next_to_trajectory", reason: "R5a", kind: "by design", note: "Agent Threads writes no files; only the text part of the tool output survives." },
  { id: "codex: loaded_orphan_subagent_excludes_copied_history", reason: "R10", kind: "by design", note: "Listed because the port adds a prompt step to the orphan (Agent Threads needs a prompt to start a turn), and the orphan keeps it. Read alone, the export starts at the rollout's own subagent_history_start_ordinal, so the copied history, its copied parent prompt included, is left out." },
  { id: "codex: mcp_image_block_is_saved", reason: "R5a", kind: "by design", note: "Agent Threads writes no files; only the text part of the tool output survives." },
  { id: "codex: missing_root_usage_keeps_combined_totals_unknown", reason: "R2", kind: "not handled", note: "A child no spawn_agent call names is not attached; Harbor links by parent_thread_id alone." },
  { id: "codex: one_step_per_api_call_with_bundled_tool_calls", reason: "R6", kind: "not handled", note: "Agent Threads puts token totals on the turn's last step and does not write llm_call_count per API call." },
  { id: "codex: other_blocks_are_kept_as_json_text[0]", reason: "R5b", kind: "not handled", note: "Only the text part of a tool output is kept; Harbor JSON-encodes the other block beside it." },
  { id: "codex: other_blocks_are_kept_as_json_text[1]", reason: "R5b", kind: "not handled", note: "Only the text part of a tool output is kept; Harbor JSON-encodes the other block beside it." },
  { id: "codex: other_blocks_are_kept_as_json_text[2]", reason: "R5b", kind: "not handled", note: "Only the text part of a tool output is kept; Harbor JSON-encodes the other block beside it." },
  { id: "codex: other_blocks_are_kept_as_json_text[3]", reason: "R5b", kind: "not handled", note: "Only the text part of a tool output is kept; Harbor JSON-encodes the other block beside it." },
  { id: "codex: other_json_values_are_not_python_reprs[3]", reason: "R5a", kind: "not handled", note: "The quoted JSON string is unwrapped; Harbor keeps it verbatim." },
  { id: "codex: other_json_values_are_not_python_reprs[4]", reason: "R5a", kind: "not handled", note: "The non-text JSON value collapses to empty text; Harbor keeps it verbatim." },
  { id: "codex: other_json_values_are_not_python_reprs[5]", reason: "R5a", kind: "not handled", note: "The non-text JSON value collapses to empty text; Harbor keeps it verbatim." },
  { id: "codex: other_json_values_are_not_python_reprs[6]", reason: "R5b", kind: "not handled", note: "Only the text part is kept; Harbor keeps the JSON verbatim." },
  { id: "codex: other_json_values_are_not_python_reprs[7]", reason: "R5a", kind: "not handled", note: "The non-text JSON value collapses to empty text; Harbor keeps it verbatim." },
  { id: "codex: remote_image_url_is_kept_in_text[0]", reason: "R5a", kind: "not handled", note: "The remote image URL leaves no [image: ...] marker in the tool output text." },
  { id: "codex: remote_image_url_is_kept_in_text[1]", reason: "R5a", kind: "not handled", note: "The remote image URL leaves no [image: ...] marker in the tool output text." },
  { id: "codex: remote_image_url_is_kept_in_text[2]", reason: "R5a", kind: "not handled", note: "The remote image URL leaves no [image: ...] marker in the tool output text." },
  { id: "codex: remote_image_url_is_kept_in_text[3]", reason: "R5a", kind: "not handled", note: "The remote image URL leaves no [image: ...] marker in the tool output text." },
  { id: "codex: structured_output_with_odd_type_values_is_kept_verbatim[0]", reason: "R5b", kind: "not handled", note: "Only well-typed text parts are kept; Harbor keeps the odd-typed blocks verbatim." },
  { id: "codex: structured_output_with_odd_type_values_is_kept_verbatim[1]", reason: "R5b", kind: "not handled", note: "Only well-typed text parts are kept; Harbor keeps the odd-typed blocks verbatim." },
  { id: "codex: structured_output_with_odd_type_values_is_kept_verbatim[2]", reason: "R5b", kind: "not handled", note: "Only well-typed text parts are kept; Harbor keeps the odd-typed blocks verbatim." },
  { id: "codex: structured_output_with_odd_type_values_is_kept_verbatim[3]", reason: "R5b", kind: "not handled", note: "Only well-typed text parts are kept; Harbor keeps the odd-typed blocks verbatim." },
  { id: "codex: structured_output_with_odd_type_values_is_kept_verbatim[4]", reason: "R5b", kind: "not handled", note: "Only well-typed text parts are kept; Harbor keeps the odd-typed blocks verbatim." },
  { id: "codex: unstorable_images_are_omitted[0]", reason: "R5a", kind: "not handled", note: "The unstorable image leaves no [image omitted] marker in the tool output text." },
  { id: "codex: unstorable_images_are_omitted[1]", reason: "R5a", kind: "not handled", note: "The unstorable image leaves no [image omitted] marker in the tool output text." },
  { id: "codex: unstorable_images_are_omitted[2]", reason: "R5a", kind: "not handled", note: "The unstorable image leaves no [image omitted] marker in the tool output text." },
  { id: "codex: user_messages_are_never_grouped", reason: "R6", kind: "not handled", note: "Agent Threads never writes llm_call_count on a step." },
  { id: "opencode: cache_tokens_in_metrics", reason: "R11", kind: "not handled", note: "The 200 cache-write tokens are in prompt_tokens (705, not 505) and kept as metrics.extra.cache_creation_input_tokens with the turn's scope, not as cache_write_tokens." },
  { id: "opencode: multiple_reasoning_events_are_joined", reason: "R13", kind: "not handled", note: "Agent Threads does not read OpenCode's reasoning parts, so the step has no reasoning_content." },
  { id: "opencode: multiple_turns", reason: "R8", kind: "not handled", note: "Steps and token totals match; Agent Threads writes no total_cost_usd." },
  { id: "opencode: no_user_step_without_instruction_or_event", reason: "R3", kind: "by design", note: "Without a prompt the session has no turn, so the export prints no trajectory; Harbor writes the agent step alone." },
  { id: "opencode: reasoning_content_is_captured", reason: "R13", kind: "not handled", note: "Agent Threads does not read OpenCode's reasoning parts, so the step has no reasoning_content." },
  { id: "opencode: text_only_turn", reason: "R8", kind: "not handled", note: "The step and its tokens match; Agent Threads writes no cost_usd." },
  { id: "opencode: tool_call_turn", reason: "R15", kind: "not handled", note: "The call, its id and its result match, but OpenCode's calls.sh prints no arguments, so arguments is {} with extra.arguments_unread." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[0]", reason: "R14", kind: "by design", note: "The failed call (a text error, no output; a 1.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[1]", reason: "R14", kind: "by design", note: "The failed call (a text error, no output; a 2.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[2]", reason: "R14", kind: "by design", note: "The failed call (an error object, no output; a 1.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success. Its content is the error's message, not Python's text of the object." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[3]", reason: "R14", kind: "by design", note: "The failed call (an error object, no output; a 2.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success. Its content is the error's message, not Python's text of the object." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[4]", reason: "R14", kind: "by design", note: "The failed call (an empty error, no output; a 1.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[5]", reason: "R14", kind: "by design", note: "The failed call (an empty error, no output; a 2.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[6]", reason: "R14", kind: "by design", note: "The failed call (a text error, partial output; a 1.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[7]", reason: "R14", kind: "by design", note: "The failed call (a text error, partial output; a 2.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[8]", reason: "R14", kind: "by design", note: "The failed call (an error object, partial output; a 1.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[9]", reason: "R14", kind: "by design", note: "The failed call (an error object, partial output; a 2.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[10]", reason: "R14", kind: "by design", note: "The failed call (an empty error, partial output; a 1.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[11]", reason: "R14", kind: "by design", note: "The failed call (an empty error, partial output; a 2.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[12]", reason: "R14", kind: "by design", note: "The failed call (a text error, empty output; a 1.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[13]", reason: "R14", kind: "by design", note: "The failed call (a text error, empty output; a 2.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[14]", reason: "R14", kind: "by design", note: "The failed call (an error object, empty output; a 1.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[15]", reason: "R14", kind: "by design", note: "The failed call (an error object, empty output; a 2.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[16]", reason: "R14", kind: "by design", note: "The failed call (an empty error, empty output; a 1.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: failed_tool_is_an_observation_with_error_metadata[17]", reason: "R14", kind: "by design", note: "The failed call (an empty error, empty output; a 2.x database) has tool_result_is_error true and the successful one false, where Harbor writes extra.error on the failure and no extra on the success." },
  { id: "opencode-v2: trajectory_keeps_tool_observations_and_native_usage", reason: "R16", kind: "by design", note: "The call, its result and the token totals match; the agent is named opencode for both OpenCode versions, not opencode-v2." },
  { id: "opencode-v2: trajectory_retains_a_final_turn_without_step_finish", reason: "R16", kind: "by design", note: "The steps match; the agent is named opencode for both OpenCode versions, not opencode-v2." },
  { id: "opencode-v2: unfinished_tool_does_not_get_a_fabricated_observation", reason: "R7", kind: "by design", note: "Agent Threads retains a marked observation for a call that has no result." },
  { id: "codex: web_search_calls_preserve_native_ids_and_get_unique_fallbacks", reason: "R9", kind: "not handled", note: "Agent Threads gives each web_search_call a generated id and no observation; Harbor keeps native ids and results." },
];

// control: the export of the case's control session (diff.control), when it has one.
export function checkCase(item, trajectory, control) {
  try {
    if (trajectory != null) expect(problems(trajectory)).toEqual([]);
    const listed = EXPECTED_DIFFERENCES.find((entry) => entry.id === item.id);
    if (listed) {
      expect(item.diff?.reason).toBe(listed.reason);
      // An export that writes nothing does not say why: the control, the same session with the
      // stated cause removed, must export, or the difference is not shown.
      if (trajectory == null) expect(control != null && problems(control).length === 0).toBe(true);
      item.diff.check(trajectory, control);
      // Harbor's facts must fail on one of their assertions, not on a type error on the way.
      expect(() => item.facts(trajectory)).toThrow(AssertionError);
    }
    else item.facts(trajectory);
  } catch (error) { throw new Error(`${item.id}: ${error.message}`); }
}

// Source inventory: every remaining pytest item is explicit; parameter indexes follow source
// order. Left-out items are Harbor's own plumbing: 8 litellm price mocks, 7 logs-folder
// discovery or root-selection tests, 1 agent-object reuse test and 1 Hypothesis property. For
// OpenCode the inventory is the trajectory items of test_opencode.py (TestOpenCodeMillisToIso,
// TestOpenCodeParseStdout, TestOpenCodeConvertEvents, TestOpenCodePopulateContextPostRun) and of
// test_opencode_v2.py (the seven functions from test_trajectory_retains_a_final_turn_without_step_finish
// on); the left-out ones test Harbor's stdout reader, time helper and run() plumbing.
export const LEFT_OUT = [
  { id: "claude: user_message_byte_faithful_property_hypothesis", reason: "Harbor's Hypothesis property test needs Python's generator; the fixed corpus test in claude.test.js covers the same inputs." },
  { id: "claude: repeated_trajectory_conversions_do_not_leak_state", reason: "Harbor reuses one agent object across conversions to prove no state leaks; Agent Threads runs a fresh command-line process per export, so leaked state cannot carry over." },
  { id: "claude: missing_result_event_estimates_cost_per_resolved_model", reason: "Harbor mocks litellm's price table; Agent Threads has none and writes no cost." },
  { id: "claude: unpriceable_step_leaves_cost_unknown", reason: "Harbor mocks litellm's price table; Agent Threads has none and writes no cost." },
  { id: "claude: partially_priceable_steps_keep_priced_costs_but_no_total", reason: "Harbor mocks litellm's price table; Agent Threads has none and writes no cost." },
  { id: "claude: get_session_dir_returns_only_directory_with_jsonl", reason: "Harbor tests its logs-folder discovery; Agent Threads exports one named transcript file." },
  { id: "claude: get_session_dir_returns_none_with_multiple_directories_with_jsonl", reason: "Harbor tests its logs-folder discovery; Agent Threads exports one named transcript file." },
  { id: "claude: get_session_dir_returns_nested_session_dir", reason: "Harbor tests its logs-folder discovery; Agent Threads exports one named transcript file." },
  { id: "claude: get_session_dir_returns_none_with_multiple_nested_sessions_under_one_project", reason: "Harbor tests its logs-folder discovery; Agent Threads exports one named transcript file." },
  { id: "claude: get_session_dir_nested_multiple_projects_returns_none", reason: "Harbor tests its logs-folder discovery; Agent Threads exports one named transcript file." },
  { id: "codex: cumulative_usage_above_272k_keeps_per_call_short_context_pricing", reason: "Harbor mocks litellm's long-context price table; Agent Threads has none and writes no cost." },
  { id: "codex: single_call_above_272k_uses_long_context_pricing", reason: "Harbor mocks litellm's long-context price table; Agent Threads has none and writes no cost." },
  { id: "codex: legacy_usage_without_cache_write_remains_supported", reason: "Harbor mocks litellm's long-context price table; Agent Threads has none and writes no cost." },
  { id: "codex: gpt_5_6_sol_500k_call_uses_long_context_pricing", reason: "Harbor mocks litellm's long-context price table; Agent Threads has none and writes no cost." },
  { id: "codex: mixed_context_calls_sum_each_calls_pricing_tier", reason: "Harbor mocks litellm's price table; Agent Threads has none and writes no cost." },
  { id: "codex: incomplete_rollout_does_not_replace_valid_root[0]", reason: "Harbor tests which rollout file it picks as root from a logs folder; Agent Threads exports one named rollout file." },
  { id: "codex: incomplete_rollout_does_not_replace_valid_root[1]", reason: "Harbor tests which rollout file it picks as root from a logs folder; Agent Threads exports one named rollout file." },
  { id: "opencode: converts_millis_timestamp", reason: "Harbor tests its own time helper; the export's times are checked by test/opencode-atif.test.js." },
  { id: "opencode: returns_none_for_none", reason: "Harbor tests its own time helper; the export's times are checked by test/opencode-atif.test.js." },
  { id: "opencode: handles_invalid_timestamp", reason: "Harbor tests its own time helper; the export's bad end times (0, not a number, before the start) are checked by test/opencode-atif.test.js." },
  { id: "opencode: reads_utf8_with_non_utf8_default_encoding", reason: "Harbor reads `opencode run --format json` output; Agent Threads reads OpenCode's database, so there are no JSON lines to read." },
  { id: "opencode: rejects_invalid_utf8", reason: "Harbor reads `opencode run --format json` output; Agent Threads reads OpenCode's database, so there are no JSON lines to read." },
  { id: "opencode: parses_json_lines", reason: "Harbor reads `opencode run --format json` output; Agent Threads reads OpenCode's database, so there are no JSON lines to read." },
  { id: "opencode: returns_empty_when_no_file", reason: "Harbor reads `opencode run --format json` output; Agent Threads reads OpenCode's database, so there are no JSON lines to read." },
  { id: "opencode: skips_non_json_lines", reason: "Harbor reads `opencode run --format json` output; Agent Threads reads OpenCode's database, so there are no JSON lines to read." },
  { id: "opencode: populates_context_and_writes_trajectory", reason: "Harbor fills its run context and writes trajectory.json; Agent Threads prints the export and fills no context." },
  { id: "opencode: noop_when_no_output_file", reason: "Harbor fills its run context and writes trajectory.json; Agent Threads prints the export and fills no context." },
  { id: "opencode: noop_when_output_has_no_valid_events", reason: "Harbor fills its run context and writes trajectory.json; Agent Threads prints the export and fills no context." },
  { id: "opencode-v2: failed_tool_does_not_turn_a_recovered_run_into_a_provider_failure", reason: "Harbor runs its agent's run() with mocked execution and reads the trajectory.json it writes; the export's part, a failed call's text and the reply after it, is covered by failed_tool_is_an_observation_with_error_metadata." },
  { id: "opencode-v2: context_does_not_invent_zero_usage_for_missing_metrics", reason: "Harbor fills its run context and writes trajectory.json; Agent Threads prints the export and fills no context." },
  { id: "opencode-v2: stdout_skips_non_object_json", reason: "Harbor reads `opencode run --format json` output; Agent Threads reads OpenCode's database, so there are no JSON lines to read." },
];
// Differences no ported Harbor item reaches: shapes our export writes that Harbor's converter
// would most likely write another way. Each is checked by the test in claude.test.js named
// after its id, and none counts in COUNTS (they are not Harbor's items).
export const OUR_DIFFERENCES = [
  { id: "ours: task_notification_after_a_finished_turn", reason: "R12", kind: "by design", note: "A task notification that wakes the agent after a turn has finished starts a turn of its own: a user step with message \"\" and extra.sender { kind: \"task-notification\" }, then the agent's steps. Agent Threads does not keep the notice's text (the <task-notification> block is the harness's, not a person's words, and the Chat shows only \"Background task finished\"); Harbor would most likely carry that text as the user message. A notice while a turn is open stays on that turn." },
];
export const COUNTS = { items: { pass: 48, listed: 93, leftOut: 31, total: 172 }, functions: { claude: 52, codex: 30, opencode: 24, "opencode-v2": 7, total: 113 } };
