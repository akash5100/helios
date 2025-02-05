import Config from "../Configuration.js";
import ThreeScene from "./three/three_scene.js";
import ModelFactory from "./model_factory.js";
import { GetImageScaleForResolution } from "../common/resolution_lookup.js";
import Loader from "../UI/loader.js";

/**
 * Manages the full 3js scene that is rendered.
 */
class Scene {
    constructor() {
        /**
         * Threejs implementation of the scene
         * @private
         */
        this._scene = new ThreeScene(Config.viewport_id);

        /**
         * List of callback functions waiting for the time to update
         * @private
         */
        this._time_listeners = [];

        /**
         * Mapping of ids to models for the UI to reference scene objects
         * @private
         */
        this._models = {};

        /**
         * Current model count used for creating IDs
         * @private
         */
        this._count = 0;

        /**
         * Current scene time.
         * @private
         */
        this._current_time = new Date();

        /**
         * Model that camera is locked on to.
         * @private
         */
        this._camera_lock = null;
    }

    /**
     * Returns the overall time range of all objects in the scene.
     * @returns {Date[]} Where date[0] is min and date[1] is max.
     */
    GetTimeRange() {
        let ids = Object.keys(this._models);
        if (ids.length > 0) {
            let min_date = this._models[ids[0]].startTime;
            let max_date = this._models[ids[0]].endTime;
            for (const id of Object.keys(this._models)) {
                let model = this._models[id];
                // Find min
                if (model.startTime < min_date) {
                    min_date = model.startTime;
                }
                // Find max
                if (model.endTime > max_date) {
                    max_date = model.endTime;
                }
            }
            return [min_date, max_date];
        } else {
            throw "No models in the scene";
        }
    }

    /**
     * Adds a new source to the scene
     *
     * @param {number} source Telescope source ID
     * @param {Date} start Beginning of time range to query
     * @param {Date} end End of time range to query
     * @param {number} cadence Number of seconds between each image
     * @param {number} scale Image scale that will be requested
     * @param {number} layer_order Layer order of the image in the scene.
     * @returns {number} identifier for model in the scene
     */
    async AddToScene(source, start, end, cadence, scale, layer_order) {
        try {
            // Start the loading animation
            Loader.start();
            let sun = await ModelFactory.CreateSolarModel(source, start, end, cadence, scale);
            let model = await sun.GetModel();
            this._scene.AddModel(model);

            let id = this._count++;
            this._models[id] = {
                startTime: start,
                endTime: end,
                model: sun,
                order: layer_order,
                cadence: cadence,
            };
            if (this._count == 1) {
                this._scene.MoveCamera(sun.GetObserverPosition());
                this._scene.PointCamera(await sun.GetPosition());
                this.SetTime(start);
            }

            sun.SetTime(this._current_time);
            this._SortLayers();
            // End the loading animation
            Loader.stop();
            return id;
        } catch (e) {
            Loader.stop();
            throw e;
        }
    }

    /**
     * Updates the current scene with new resolution
     *
     * @param {number} resolution
     */
    async UpdateResolution(resolution) {
        for (let id in this._models) {
            const model = this._models[id];
            // get the id of new scene
            let new_id = await this.AddToScene(model.model.source, model.startTime, model.endTime, model.cadence, GetImageScaleForResolution(resolution, model.model.source), model.order);
            await this.RemoveFromScene(id);
            // overwrite the original with the new_id
            this._models[id] = this._models[new_id];
            // remove the new scene
            delete this._models[new_id];
        }
    }

    /**
     * Set the model's layering order so they appear correctly in the scene.
     */
    _SortLayers() {
        let keys = Object.keys(this._models);
        for (const id of keys) {
            this._models[id].model.SetLayerOrder(this._models[id].order, keys.length);
        }
    }

    /**
     * Removes a model from the scene
     * @param {number} id Identifier of model to remove
     */
    async RemoveFromScene(id) {
        this._scene.RemoveModel(await this._models[id].model.GetModel());
        delete this._models[id];
    }

    /**
     * Locks the camera to a specific model's observer
     * @param {number} id Identifier of model to track the camera to.
     */
    LockCamera(id) {
        this._camera_lock = this._models[id];
    }

    /**
     * Unlocks the camera position from whichever model it is locked to.
     */
    UnlockCamera() {
        this._camera_lock = null;
    }

    /**
     * Update the scene to the specified time
     * @param {Date} date New scene time
     */
    async SetTime(date) {
        this._current_time = date;

        let ids = Object.keys(this._models);
        for (const id of ids) {
            await this._models[id].model.SetTime(date);
        }

        // If camera is locked on to a specific model, then update its position.
        // This must happen after the model time updates have completed.
        if (this._camera_lock) {
            this._scene.MoveCamera(this._camera_lock.model.GetObserverPosition());
            this._scene.PointCamera(await this._camera_lock.model.GetPosition());
        }

        for (const callback of this._time_listeners) {
            callback(this._current_time);
        }
    }

    /**
     * Returns the current time of the scene
     * @returns {Date} scene time
     */
    GetTime() {
        return this._current_time;
    }

    /**
     * Registers a callback to be executed when the scene time is updated
     * @param {Function} fn Callback function that takes a date as a parameter
     */
    RegisterTimeUpdateListener(fn) {
        this._time_listeners.push(fn);
        fn(this._current_time);
    }

    /**
     * Returns the timestamp of a given model
     * @param {number} id ID of the model returned by AddToScene
     * @return {Date}
     */
    GetModelTime(id) {
        return this._models[id].model.current_time;
    }

    /**
     * Updates the opacity of the model associated with the given ID
     * @param {number} id ID returned from AddToScene
     * @param {number} opacity New opacity to apply to the model
     */
    SetModelOpacity(id, opacity) {
        this._models[id].model.SetOpacity(opacity);
    }

    /**
     * Notifies objects in the scene to reset to the current time.
     */
    Refresh() {
        this.SetTime(this.GetTime());
    }
}

// There is only one scene in the application
let scene = new Scene();
export default scene;
