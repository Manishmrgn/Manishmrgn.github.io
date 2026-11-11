/* projects.js — the project list. One source for the generated pages (tools/build.js) and the home page.
 * Edit text here, then re-run the generator. Newest year first.
 *
 * Browser:  window.PROJECTS      Node:  require('./js/projects.js')
 */
(function (root) {
  'use strict';

  // ═══════════════════════════ DATA — edit here ═══════════════════════════
  var PROJECTS = [
    { slug: 'sft-data', title: 'Synthetic SFT data', where: 'Dimaag-AI', year: 2026,
      oneLiner: 'Generating fine-tuning data for a domain-specific LLM tool-calling assistant.',
      tags: ['llm', 'sft', 'data'],
      overview: {
        problem: 'a tool-calling assistant needs training dialogues that match what its backend really returns, and hand-written ones drift from that.',
        built: [
          'a pipeline that writes multi-turn dialogues grounded in real backend tool outputs',
          'multi-tool routing driven by versioned YAML constraint prompts',
          'regex validators with corrective retry loops, in place of hard-coded output patches'
        ],
        results: [
          'synthetic artifacts get caught and retried instead of leaking into the training data',
          'constraints live in versioned prompts, so a change to them is easy to review'
        ]
      },
      figures: [] },

    { slug: 'agent-harness', title: 'Qwen3 agent harness', where: 'Dimaag-AI', year: 2026,
      oneLiner: 'A harness that runs a Qwen3 32B agent with sandboxed code and context compaction.',
      tags: ['llm', 'agents', 'vlm'],
      overview: {
        problem: 'an agent with many tools burns its context window on schemas and old turns before it does any work.',
        built: [
          'a Qwen3 32B agent harness with network-isolated code execution',
          'LLM-based context compaction, and deduplicated tool schemas',
          'document VLM and RAG ingest tools, and a benchmark of Qwen3-VL 32B and Qwen2.5-VL 72B'
        ],
        results: [
          'deduplicating tool schemas cut the fixed per-call cost 45% (9.2k to 5.0k tokens)',
          '85% of a 32k context window stays free'
        ]
      },
      figures: [] },

    { slug: 'price-forecasting', title: 'Price forecasting', where: 'ITC Infotech', year: 2025,
      oneLiner: 'Time series price forecasting for an agri business, with Type-2 fuzzy logic regression.',
      tags: ['forecasting', 'time series'],
      overview: {
        problem: 'the ITC Ltd. agri business needed price forecasts it could plan around.',
        built: [
          'a time series model using Type-2 fuzzy logic regression',
          'automated data pipelines, controlled experiments, and evaluation with MAE, RMSE and ablations'
        ],
        results: [
          '92.7% forecast accuracy (7.3% MAPE)'
        ]
      },
      figures: [] },

    { slug: 'ai-town', title: 'AI-Town narrative sim', where: 'personal', year: 2025,
      oneLiner: 'An AI-Town fantasy world where NPC conversations turn into story events.',
      tags: ['llm', 'llama-3', 'docker'],
      overview: {
        problem: 'AI-Town characters talk, but nothing they say adds up to a story.',
        built: [
          'an extension of AI-Town into an interactive fantasy world, with an offline LLaMA-3 model in Docker for local NPC dialogue and world updates',
          'a real-time narration system that turns NPC conversations into story events',
          'player-NPC interactions that can change the narrative'
        ],
        results: [
          'the whole thing runs offline on one machine',
          'what the player says can change where the story goes'
        ]
      },
      figures: [] },

    { slug: 'raster', title: 'True-scale 3D from drones', where: 'IISc Aerospace (AIRL)', year: 2024,
      oneLiner: 'Structure from motion that recovers real-world scale with YOLOv8 and ArUco markers.',
      tags: ['sfm', 'yolov8', 'aruco', 'unreal'],
      with: ['Meghana V Gaonkar', 'Leona E Joseph', 'advisor: Dr. R Balamurugan (VIT)', 'advisor: Dr. Suresh Sundaram (IISc)'],
      pdf: 'assets/papers/raster-poster.pdf', pdfLabel: 'poster',
      overview: {
        problem: 'structure from motion rebuilds a scene but not its size, so a model made from drone photos has no real-world scale.',
        built: [
          'RASTER, a pipeline that detects ArUco markers with YOLOv8 and uses them to compute an absolute scale factor',
          'synthetic training data from Unreal Engine 5, annotated automatically, with randomized markers, poses, lighting, blur and lens distortion',
          '3D background subtraction (parallelized KD-Tree/FLANN and Octree) to pull an object out of a scene'
        ],
        results: [
          'detection reached 98.6% mAP@50 over 10 YOLOv8 + cv2.aruco pipelines',
          'absolute scale recovered within 0.2 cm on an 18 cm marker',
          'background subtraction on 10M-point clouds went from 27 h to 40 s (2,400x faster)'
        ]
      },
      figures: [] },

    { slug: 'nerf', title: 'NeRF, faster', where: 'IISc', year: 2024,
      oneLiner: 'CUDA kernels to speed up neural radiance field training.',
      tags: ['cuda', 'nerf', 'sfm'],
      with: ['advisor: Dr. Suresh Sundaram'],
      overview: {
        problem: 'neural radiance fields give good 3D reconstructions but training them is slow.',
        built: [
          'a CUDA-optimized NeRF',
          'an end-to-end 3D reconstruction flow alongside Structure from Motion (Meshroom), with ArUco-based metric calibration to recover true scale for as-built modeling'
        ],
        results: [
          'a working end-to-end reconstruction that comes out at true scale'
        ]
      },
      figures: [] },

    { slug: 'debris', title: 'Beach trash from the air', where: 'VIT', year: 2024,
      oneLiner: 'Spotting coastal debris in drone images with YOLOv8 and Wise-IoU.',
      tags: ['yolov8', 'uav', 'wise-iou'],
      with: ['Meghana V Gaonkar', 'Leona E Joseph', 'advisor: Dr. R Balamurugan'],
      pdf: 'assets/papers/uav-debris-paper.pdf', pdfLabel: 'paper',
      overview: {
        problem: 'plastic on shorelines is hard to survey on foot; drones see a lot of coast, but something has to find the debris in the images.',
        built: [
          'a benchmark of five YOLOv8 variants (n, s, m, l, x) with and without a Wise-IoU loss',
          'hyperparameter tuning and custom augmentation on a dataset combining two UAV sources'
        ],
        results: [
          'YOLOv8m went from 81.7% to 86.1% mAP@50',
          'Wise-IoU hurt the largest models'
        ]
      },
      figures: [] }
  ];
  // ═══════════════════════════════════════════════════════════════════════════

  if (typeof module !== 'undefined' && module.exports) module.exports = PROJECTS;
  else root.PROJECTS = PROJECTS;
})(typeof window !== 'undefined' ? window : this);
