// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_claude_code_trajectory.py
// and tests/unit/agents/installed/test_codex_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Ported cases are named in the case tables.
import { expect } from "bun:test";
import { problems } from "../atif-schema.js";

// One entry per ported Harbor item our export differs from on purpose. Reason codes:
// R1 no reasoning_content (OpenRouter decoding) · R2 helpers nested, not flat · R3 no human
// prompt, no turn · R4 user text not normalized Harbor's way · R5a we write no files and
// results are text · R5b non-text blocks leave no marker · R6 tokens per turn, llm_call_count
// never written · R7 a call with no result keeps a marked observation entry · R8 no cost
// fields · R9 a Codex web_search_call loses its id · R10 a lone Codex subagent rollout keeps
// its own prompt as a step.
export const EXPECTED_DIFFERENCES = [
  { id: "claude: agent_steps_carry_llm_call_count", reason: "R6", kind: "not handled", note: "Agent Threads never writes llm_call_count; token totals go on the turn's last step." },
  { id: "claude: byte_faithful_property_across_inputs[0]", reason: "R3", kind: "by design", note: "An empty prompt makes no turn in Agent Threads." },
  { id: "claude: byte_faithful_property_across_inputs[4]", reason: "R4", kind: "not handled", note: "Agent Threads keeps the whitespace-only prompt; Harbor skips it." },
  { id: "claude: byte_faithful_property_across_inputs[5]", reason: "R4", kind: "not handled", note: "Agent Threads keeps the whitespace-only prompt; Harbor skips it." },
  { id: "claude: distinct_subagent_ids_survive_the_combined_timeline", reason: "R2", kind: "by design", note: "Agent Threads nests helper steps and links them from the launching call; Harbor flattens them." },
  { id: "claude: fallback_branch_stringifies_non_dict_shapes[0]", reason: "R5b", kind: "not handled", note: "Non-str, non-list user content leaves no marker and no turn; Harbor stringifies it." },
  { id: "claude: fallback_branch_stringifies_non_dict_shapes[1]", reason: "R5b", kind: "not handled", note: "Non-str, non-list user content leaves no marker and no turn; Harbor stringifies it." },
  { id: "claude: fallback_branch_stringifies_non_dict_shapes[2]", reason: "R5b", kind: "not handled", note: "Non-str, non-list user content leaves no marker and no turn; Harbor stringifies it." },
  { id: "claude: fallback_branch_stringifies_non_dict_shapes[3]", reason: "R5b", kind: "not handled", note: "Non-str, non-list user content leaves no marker and no turn; Harbor stringifies it." },
  { id: "claude: fallback_content_non_str_non_list_byte_faithful", reason: "R5b", kind: "not handled", note: "Non-str, non-list user content leaves no marker and no turn; Harbor stringifies it byte for byte." },
  { id: "claude: list_branch_interleaved_text_and_tool_result", reason: "R3", kind: "by design", note: "Without a human prompt the session exports no trajectory; Harbor still joins the interleaved texts." },
  { id: "claude: list_content_empty_and_whitespace_only_parts_filtered", reason: "R4", kind: "not handled", note: "Agent Threads joins the parts it keeps with blank lines instead of filtering to the one non-blank part." },
  { id: "claude: list_content_multiple_text_blocks_joined_verbatim", reason: "R4", kind: "not handled", note: "Agent Threads joins user text blocks with one newline; Harbor joins with two." },
  { id: "claude: list_content_non_text_non_tool_result_block_json_encoded", reason: "R5b", kind: "not handled", note: "Agent Threads records image metadata in extra.images but does not JSON-encode the image block into message." },
  { id: "claude: redacted_thinking_openrouter_payload_decoded_to_reasoning", reason: "R1", kind: "by design", note: "Agent Threads treats redacted_thinking as opaque; Harbor decodes OpenRouter's wrapper." },
  { id: "claude: string_content_empty_is_skipped", reason: "R3", kind: "by design", note: "An empty prompt makes no turn in Agent Threads, so the export prints no trajectory." },
  { id: "claude: string_content_whitespace_only_is_skipped", reason: "R4", kind: "not handled", note: "Agent Threads keeps a whitespace-only prompt verbatim; Harbor filters it out." },
  { id: "claude: stringify_uses_json_dumps_for_non_str", reason: "R5b", kind: "not handled", note: "Non-str, non-list user content leaves no marker and no turn; Harbor writes Python json.dumps of it." },
  { id: "claude: subagent_events_deduped_by_uuid_across_files", reason: "R2", kind: "by design", note: "The unnamed helper is read as its own transcript (extra.subagents_no_call_names) instead of flat sidechain steps." },
  { id: "claude: subagent_file_events_become_sidechain_steps", reason: "R2", kind: "by design", note: "The helper's steps nest under subagent_trajectories and link from the launching call; Harbor flattens them into the main steps." },
  { id: "claude: tool_use_without_result_renders_call_without_observation", reason: "R7", kind: "by design", note: "Agent Threads retains a marked observation for a call that has no result." },
  { id: "claude: verbatim_production_layout", reason: "R2", kind: "by design", note: "The unnamed helper lands in extra.subagents_no_call_names instead of flat sidechain steps." },
  { id: "codex: codex_grandchild_is_nested_under_its_parent", reason: "R3", kind: "by design", note: "The child and grandchild keep their own prompt steps; Harbor's hold only their work steps." },
  { id: "codex: codex_subagent_rollouts_use_atif_children_without_copied_history", reason: "R3", kind: "by design", note: "Each child keeps its own prompt step and its nickname lands in extra.agent_name; Harbor's child holds only its work step." },
  { id: "codex: codex_uses_active_turn_model_for_steps_and_pricing", reason: "R8", kind: "not handled", note: "Step models match, but Agent Threads writes no cost_usd anywhere." },
  { id: "codex: data_url_containing_a_url_is_not_treated_as_remote", reason: "R5a", kind: "by design", note: "The image part leaves no marker in the tool output text." },
  { id: "codex: data_url_parameters_do_not_hide_the_media_type", reason: "R5a", kind: "by design", note: "Agent Threads writes no files; only the text part of the tool output survives." },
  { id: "codex: dict_output_that_is_not_a_string_is_kept_as_json[0]", reason: "R5a", kind: "by design", note: "Tool output stays text and no tool_call_details metadata is written; Harbor keeps both." },
  { id: "codex: dict_output_that_is_not_a_string_is_kept_as_json[1]", reason: "R5a", kind: "by design", note: "Tool output stays text and no tool_call_details metadata is written; Harbor keeps both." },
  { id: "codex: dict_output_that_is_not_a_string_is_kept_as_json[2]", reason: "R5a", kind: "by design", note: "Tool output stays text and no tool_call_details metadata is written; Harbor keeps both." },
  { id: "codex: dict_output_that_is_not_a_string_is_kept_as_json[3]", reason: "R5a", kind: "by design", note: "Tool output stays text and no tool_call_details metadata is written; Harbor keeps both." },
  { id: "codex: dict_output_that_is_not_a_string_is_kept_as_json[4]", reason: "R5a", kind: "by design", note: "Tool output stays text and no tool_call_details metadata is written; Harbor keeps both." },
  { id: "codex: images_are_never_written_through_a_planted_symlink[0]", reason: "R5a", kind: "by design", note: "Agent Threads writes no files at all, so nothing is written through the planted path." },
  { id: "codex: images_are_never_written_through_a_planted_symlink[1]", reason: "R5a", kind: "by design", note: "Agent Threads writes no files at all, so nothing is written through the planted path." },
  { id: "codex: images_are_never_written_through_a_planted_symlink[2]", reason: "R5a", kind: "by design", note: "Agent Threads writes no files at all, so nothing is written through the planted path." },
  { id: "codex: input_image_data_url_is_saved_next_to_trajectory", reason: "R5a", kind: "by design", note: "Agent Threads writes no files; only the text part of the tool output survives." },
  { id: "codex: loaded_orphan_subagent_excludes_copied_history", reason: "R10", kind: "by design", note: "The orphan keeps its prompt step; its copied history is cut by the ordinal boundary when read alone." },
  { id: "codex: mcp_image_block_is_saved", reason: "R5a", kind: "by design", note: "Agent Threads writes no files; only the text part of the tool output survives." },
  { id: "codex: missing_root_usage_keeps_combined_totals_unknown", reason: "R2", kind: "not handled", note: "A child no spawn_agent call names is not attached; Harbor links by parent_thread_id alone." },
  { id: "codex: one_step_per_api_call_with_bundled_tool_calls", reason: "R6", kind: "not handled", note: "Agent Threads puts token totals on the turn's last step and does not write llm_call_count per API call." },
  { id: "codex: other_blocks_are_kept_as_json_text[0]", reason: "R5b", kind: "not handled", note: "Only the text part of a tool output is kept; Harbor JSON-encodes the other block beside it." },
  { id: "codex: other_blocks_are_kept_as_json_text[1]", reason: "R5b", kind: "not handled", note: "Only the text part of a tool output is kept; Harbor JSON-encodes the other block beside it." },
  { id: "codex: other_blocks_are_kept_as_json_text[2]", reason: "R5b", kind: "not handled", note: "Only the text part of a tool output is kept; Harbor JSON-encodes the other block beside it." },
  { id: "codex: other_blocks_are_kept_as_json_text[3]", reason: "R5b", kind: "not handled", note: "Only the text part of a tool output is kept; Harbor JSON-encodes the other block beside it." },
  { id: "codex: other_json_values_are_not_python_reprs[3]", reason: "R5a", kind: "by design", note: "The quoted JSON string is unwrapped; Harbor keeps it verbatim." },
  { id: "codex: other_json_values_are_not_python_reprs[4]", reason: "R5a", kind: "by design", note: "The non-text JSON value collapses to empty text; Harbor keeps it verbatim." },
  { id: "codex: other_json_values_are_not_python_reprs[5]", reason: "R5a", kind: "by design", note: "The non-text JSON value collapses to empty text; Harbor keeps it verbatim." },
  { id: "codex: other_json_values_are_not_python_reprs[6]", reason: "R5b", kind: "not handled", note: "Only the text part is kept; Harbor keeps the JSON verbatim." },
  { id: "codex: other_json_values_are_not_python_reprs[7]", reason: "R5a", kind: "by design", note: "The non-text JSON value collapses to empty text; Harbor keeps it verbatim." },
  { id: "codex: remote_image_url_is_kept_in_text[0]", reason: "R5a", kind: "by design", note: "The remote image URL leaves no [image: ...] marker in the tool output text." },
  { id: "codex: remote_image_url_is_kept_in_text[1]", reason: "R5a", kind: "by design", note: "The remote image URL leaves no [image: ...] marker in the tool output text." },
  { id: "codex: remote_image_url_is_kept_in_text[2]", reason: "R5a", kind: "by design", note: "The remote image URL leaves no [image: ...] marker in the tool output text." },
  { id: "codex: remote_image_url_is_kept_in_text[3]", reason: "R5a", kind: "by design", note: "The remote image URL leaves no [image: ...] marker in the tool output text." },
  { id: "codex: structured_output_with_odd_type_values_is_kept_verbatim[0]", reason: "R5b", kind: "not handled", note: "Only well-typed text parts are kept; Harbor keeps the odd-typed blocks verbatim." },
  { id: "codex: structured_output_with_odd_type_values_is_kept_verbatim[1]", reason: "R5b", kind: "not handled", note: "Only well-typed text parts are kept; Harbor keeps the odd-typed blocks verbatim." },
  { id: "codex: structured_output_with_odd_type_values_is_kept_verbatim[2]", reason: "R5b", kind: "not handled", note: "Only well-typed text parts are kept; Harbor keeps the odd-typed blocks verbatim." },
  { id: "codex: structured_output_with_odd_type_values_is_kept_verbatim[3]", reason: "R5b", kind: "not handled", note: "Only well-typed text parts are kept; Harbor keeps the odd-typed blocks verbatim." },
  { id: "codex: structured_output_with_odd_type_values_is_kept_verbatim[4]", reason: "R5b", kind: "not handled", note: "Only well-typed text parts are kept; Harbor keeps the odd-typed blocks verbatim." },
  { id: "codex: unstorable_images_are_omitted[0]", reason: "R5a", kind: "by design", note: "The unstorable image leaves no [image omitted] marker in the tool output text." },
  { id: "codex: unstorable_images_are_omitted[1]", reason: "R5a", kind: "by design", note: "The unstorable image leaves no [image omitted] marker in the tool output text." },
  { id: "codex: unstorable_images_are_omitted[2]", reason: "R5a", kind: "by design", note: "The unstorable image leaves no [image omitted] marker in the tool output text." },
  { id: "codex: user_messages_are_never_grouped", reason: "R6", kind: "not handled", note: "Agent Threads never writes llm_call_count on a step." },
  { id: "codex: web_search_calls_preserve_native_ids_and_get_unique_fallbacks", reason: "R9", kind: "not handled", note: "Agent Threads gives each web_search_call a generated id and no observation; Harbor keeps native ids and results." },
];

export function checkCase(item, trajectory) {
  try {
    if (trajectory != null) expect(problems(trajectory)).toEqual([]);
    const listed = EXPECTED_DIFFERENCES.find((entry) => entry.id === item.id);
    if (listed) { expect(item.diff?.reason).toBe(listed.reason); item.diff.check(trajectory); expect(() => item.facts(trajectory)).toThrow(); }
    else item.facts(trajectory);
  } catch (error) { throw new Error(`${item.id}: ${error.message}`); }
}

// Source inventory: every remaining pytest item is explicit; parameter indexes follow source
// order. Left-out items are Harbor's own plumbing: 10 litellm price mocks, 7 logs-folder
// discovery or root-selection tests, 1 agent-object reuse test and 1 Hypothesis property.
export const LEFT_OUT = [
  { id: "claude: user_message_byte_faithful_property_hypothesis", reason: "Harbor's Hypothesis property test needs Python's generator; the fixed corpus test in claude.test.js covers the same inputs." },
  { id: "claude: repeated_trajectory_conversions_do_not_leak_state", reason: "Harbor reuses one agent object across conversions to prove no state leaks; Agent Threads runs a fresh command-line process per export, so leaked state cannot carry over." },
  { id: "claude: missing_result_event_estimates_cost_per_resolved_model", reason: "Harbor mocks litellm's price table; Agent Threads has none and writes no cost." },
  { id: "claude: reported_cost_remains_authoritative", reason: "Harbor mocks litellm's price table; Agent Threads has none and writes no cost." },
  { id: "claude: unpriceable_step_leaves_cost_unknown", reason: "Harbor mocks litellm's price table; Agent Threads has none and writes no cost." },
  { id: "claude: partially_priceable_steps_keep_priced_costs_but_no_total", reason: "Harbor mocks litellm's price table; Agent Threads has none and writes no cost." },
  { id: "claude: get_session_dir_returns_only_directory_with_jsonl", reason: "Harbor tests its logs-folder discovery; Agent Threads exports one named transcript file." },
  { id: "claude: get_session_dir_returns_none_with_multiple_directories_with_jsonl", reason: "Harbor tests its logs-folder discovery; Agent Threads exports one named transcript file." },
  { id: "claude: get_session_dir_returns_nested_session_dir", reason: "Harbor tests its logs-folder discovery; Agent Threads exports one named transcript file." },
  { id: "claude: get_session_dir_returns_none_with_multiple_nested_sessions_under_one_project", reason: "Harbor tests its logs-folder discovery; Agent Threads exports one named transcript file." },
  { id: "claude: get_session_dir_nested_multiple_projects_returns_none", reason: "Harbor tests its logs-folder discovery; Agent Threads exports one named transcript file." },
  { id: "codex: cumulative_usage_above_272k_keeps_per_call_short_context_pricing", reason: "Harbor mocks litellm's long-context price table; Agent Threads has none and writes no cost." },
  { id: "codex: single_call_above_272k_uses_long_context_pricing", reason: "Harbor mocks litellm's long-context price table; Agent Threads has none and writes no cost." },
  { id: "codex: cache_write_usage_is_preserved_and_priced", reason: "Harbor mocks litellm's price table; Agent Threads has none and writes no cost." },
  { id: "codex: legacy_usage_without_cache_write_remains_supported", reason: "Harbor mocks litellm's long-context price table; Agent Threads has none and writes no cost." },
  { id: "codex: gpt_5_6_sol_500k_call_uses_long_context_pricing", reason: "Harbor mocks litellm's long-context price table; Agent Threads has none and writes no cost." },
  { id: "codex: mixed_context_calls_sum_each_calls_pricing_tier", reason: "Harbor mocks litellm's price table; Agent Threads has none and writes no cost." },
  { id: "codex: incomplete_rollout_does_not_replace_valid_root[0]", reason: "Harbor tests which rollout file it picks as root from a logs folder; Agent Threads exports one named rollout file." },
  { id: "codex: incomplete_rollout_does_not_replace_valid_root[1]", reason: "Harbor tests which rollout file it picks as root from a logs folder; Agent Threads exports one named rollout file." },
];
export const COUNTS = { items: { pass: 42, listed: 63, leftOut: 19, total: 124 }, functions: { claude: 52, codex: 30, total: 82 } };
