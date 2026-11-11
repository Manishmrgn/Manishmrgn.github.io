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
      media: '',   // optional gif/image/mp4 poster in assets/, shown in the home hover preview
      overview: {
        problem: 'a tool-calling assistant needs training dialogues that match what its backend really returns, and hand-written ones drift from that.',
        built: [
          'a pipeline that writes multi-turn dialogues grounded in real backend tool outputs',
          'multi-tool routing driven by versioned YAML constraint prompts',
          'regex validators with corrective retry loops, in place of hard-coded output patches'
        ],
        results: [
          'synthetic artifacts get caught and retried instead of leaking into the training data',
          'the routing constraints are versioned YAML, so each change to them is tracked'
        ]
      },
      figures: [] },

    { slug: 'agent-harness', title: 'Qwen3 agent harness', where: 'Dimaag-AI', year: 2026,
      oneLiner: 'A harness that runs a Qwen3 32B agent with sandboxed code and context compaction.',
      tags: ['llm', 'agents', 'vlm'],
      media: '',   // optional gif/image/mp4 poster in assets/, shown in the home hover preview
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
      media: '',   // optional gif/image/mp4 poster in assets/, shown in the home hover preview
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
      media: '',   // optional gif/image/mp4 poster in assets/, shown in the home hover preview
      overview: {
        problem: 'AI-Town characters talk, but nothing they say adds up to a story.',
        built: [
          'an extension of AI-Town into an interactive fantasy world, with an offline LLaMA-3 model in Docker for local NPC dialogue and world updates',
          'a real-time narration system that turns NPC conversations into story events',
          'player-NPC interactions that can change the narrative'
        ],
        results: [
          'NPC dialogue and world updates come from an offline LLaMA-3 model running in Docker',
          'player-NPC interactions can change the narrative'
        ]
      },
      figures: [] },

    { slug: 'raster', title: 'True-scale 3D from drones', where: 'IISc Aerospace (AIRL)', year: 2024,
      oneLiner: 'Marker detection and 3D cleanup that give drone reconstructions real-world scale.',
      tags: ['sfm', 'yolov8', 'aruco', 'unreal'],
      media: '',   // optional gif/image/mp4 poster in assets/, shown in the home hover preview
      with: ['Meghana V Gaonkar', 'Leona E Joseph', 'advisor: Dr. R Balamurugan (VIT)', 'advisor: Dr. Suresh Sundaram (IISc)'],
      pdf: 'assets/papers/raster-poster.pdf', pdfLabel: 'poster',
      overview: {
        problem: 'structure from motion rebuilds a scene but not its size, so a model made from drone photos has no real-world scale, and rescaling by hand is slow and error-prone. RASTER is the AIRL lab\'s absolute-scale pipeline (Lakshay Khurana and Dr. Suresh Sundaram), and my capstone work built its detection and subtraction parts.',
        built: [
          'marker detection with YOLOv8 and cv2.aruco, feeding RASTER\'s absolute-scale step',
          'synthetic training data from Unreal Engine 5, annotated automatically, with randomized markers, poses, lighting, blur and lens distortion',
          '3D background subtraction (parallelized KD-Tree/FLANN and Octree) to pull an object out of a scene',
          'a real dataset shot with a DSLR, one image every 5 degrees around a crate carrying a marker (72 images per circle), plus Unreal-generated scenes',
          'ten rounds of detector training, using k-fold validation and synthetic scenes to hunt down false positives, and oriented bounding boxes instead of square ones'
        ],
        results: [
          'detection reached 98.6% mAP@50 over 10 YOLOv8 + cv2.aruco pipelines',
          'absolute scale recovered within 0.2 cm on an 18 cm marker',
          'background subtraction on 10M-point clouds went from 27 h to 40 s (2,400x faster)',
          'on a synthetic room scene, a 0.1 distance threshold cleaned out the sparse stray points better than 0.01 and recovered the skull model'
        ]
      },
      figures: [
        { src: 'assets/projects/raster/pipeline.jpg', alt: 'flow diagram of the RASTER pipeline from input images and fiducial detection to an absolute-scaled, oriented 3D reconstruction', caption: 'the raster pipeline, from marker detection to a scaled mesh' },
        { src: 'assets/projects/raster/rescaled.jpg', alt: 'two views of a crate mesh with an aruco marker, measured before and after rescaling, with an 18 cm real marker and a scale factor of 4.1425', caption: 'marker edges measured 4 cm before rescale, 18 cm after' },
        { src: 'assets/projects/raster/detect.jpg', alt: 'synthetic scene of a small hut on a wooden deck with a green box around it and two aruco markers on the floor', caption: 'aruco markers and the object found in a synthetic scene' }
      ] },

    { slug: 'nerf', title: 'NeRF, faster', where: 'IISc', year: 2024,
      oneLiner: 'CUDA kernels to speed up neural radiance field training.',
      tags: ['cuda', 'nerf', 'sfm'],
      media: '',   // optional gif/image/mp4 poster in assets/, shown in the home hover preview
      with: ['advisor: Dr. Suresh Sundaram'],
      overview: {
        problem: 'neural radiance fields give good 3D reconstructions but training them is slow.',
        built: [
          'a CUDA-optimized NeRF, with Nerfstudio in the toolchain',
          'an end-to-end 3D reconstruction flow alongside Structure from Motion (Meshroom), with ArUco-based metric calibration to recover true scale for as-built modeling'
        ],
        results: [
          'a working end-to-end reconstruction that comes out at true scale',
          'Meshroom (SfM) supplies the meshes and camera poses, Nerfstudio the radiance-field side, and ArUco markers fix the scale'
        ]
      },
      figures: [] },

    { slug: 'debris', title: 'Beach trash from the air', where: 'VIT', year: 2024,
      oneLiner: 'Spotting coastal debris in drone images with YOLOv8 and Wise-IoU.',
      tags: ['yolov8', 'uav', 'wise-iou'],
      media: '',   // optional gif/image/mp4 poster in assets/, shown in the home hover preview
      with: ['Meghana V Gaonkar', 'Leona E Joseph', 'advisor: Dr. R Balamurugan'],
      pdf: 'assets/papers/uav-debris-paper.pdf', pdfLabel: 'paper',
      overview: {
        problem: 'plastic on shorelines is hard to survey on foot; drones see a lot of coast, but something has to find the debris in the images.',
        built: [
          'a benchmark of five YOLOv8 variants (n, s, m, l, x) with and without a Wise-IoU loss',
          'hyperparameter tuning and custom augmentation on a dataset combining two UAV sources (772 beach images and 40 river images), all labelled as one class, garbage',
          'offline augmentation of 40 annotated images into 120 more (blur, rotation, scale), for 892 images split 636 / 128 / 128 into train, validation and test'
        ],
        results: [
          'YOLOv8m went from 81.7% to 86.1% mAP@50',
          'Wise-IoU hurt the largest models',
          'YOLOv8l and YOLOv8x lost a lot of precision with Wise-IoU, which the paper puts down to computational limits',
          'hyperparameter tuning (rotation 45 degrees, flips 0.5 and 0.6, MixUp 0.05) lifted YOLOv8s from 80.8% to 83.5% mAP@50'
        ]
      },
      figures: [
        { src: 'assets/projects/debris/detections.jpg', alt: 'four aerial photos of water and beach with red boxes around detected bottles and other trash', caption: 'yolov8 detections on drone shots of water and shoreline' },
        { src: 'assets/projects/debris/pr-curves.jpg', alt: 'three precision-recall curves for yolov8m: standard 0.818, with tuned hyperparameters 0.847, with hyperparameters and wiou 0.861 mAP@0.5', caption: 'yolov8m precision-recall: 0.818, 0.847, then 0.861 mAP@0.5' }
      ] }
  ];
  // ═══════════════════════════════════════════════════════════════════════════

  if (typeof module !== 'undefined' && module.exports) module.exports = PROJECTS;
  else root.PROJECTS = PROJECTS;
})(typeof window !== 'undefined' ? window : this);
