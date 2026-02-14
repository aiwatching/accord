package com.example.devicemanager.controller;

import com.example.devicemanager.dto.BatchDeleteRequest;
import com.example.devicemanager.dto.BatchDeleteResponse;
import com.example.devicemanager.model.Device;
import com.example.devicemanager.model.DeviceStatus;
import com.example.devicemanager.service.DeviceService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(DeviceController.class)
class DeviceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DeviceService deviceService;

    @Test
    void batchDeleteDevices_success_allDeleted() throws Exception {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2", "device3");
        BatchDeleteRequest request = new BatchDeleteRequest(deviceIds);

        BatchDeleteResponse response = new BatchDeleteResponse();
        response.setSuccess(true);
        response.setDeleted(deviceIds);
        response.setFailed(new ArrayList<>());
        response.setTotalRequested(3);
        response.setTotalDeleted(3);

        when(deviceService.batchDeleteDevices(deviceIds)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(post("/api/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.total_requested").value(3))
                .andExpect(jsonPath("$.total_deleted").value(3))
                .andExpect(jsonPath("$.deleted.length()").value(3))
                .andExpect(jsonPath("$.failed.length()").value(0));
    }

    @Test
    void batchDeleteDevices_partialSuccess_someDevicesNotFound() throws Exception {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2", "device3");
        BatchDeleteRequest request = new BatchDeleteRequest(deviceIds);

        BatchDeleteResponse response = new BatchDeleteResponse();
        response.setSuccess(false);
        response.setDeleted(Arrays.asList("device1", "device3"));
        List<BatchDeleteResponse.BatchDeleteError> failed = new ArrayList<>();
        failed.add(new BatchDeleteResponse.BatchDeleteError("device2", "Device not found"));
        response.setFailed(failed);
        response.setTotalRequested(3);
        response.setTotalDeleted(2);

        when(deviceService.batchDeleteDevices(deviceIds)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(post("/api/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.total_requested").value(3))
                .andExpect(jsonPath("$.total_deleted").value(2))
                .andExpect(jsonPath("$.deleted.length()").value(2))
                .andExpect(jsonPath("$.failed.length()").value(1))
                .andExpect(jsonPath("$.failed[0].device_id").value("device2"))
                .andExpect(jsonPath("$.failed[0].error").value("Device not found"));
    }

    @Test
    void batchDeleteDevices_badRequest_emptyDeviceIds() throws Exception {
        // Arrange
        BatchDeleteRequest request = new BatchDeleteRequest(new ArrayList<>());

        // Act & Assert
        mockMvc.perform(post("/api/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void batchDeleteDevices_badRequest_nullDeviceIds() throws Exception {
        // Arrange
        BatchDeleteRequest request = new BatchDeleteRequest(null);

        // Act & Assert
        mockMvc.perform(post("/api/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void batchDeleteDevices_allFailed_allDevicesNotFound() throws Exception {
        // Arrange
        List<String> deviceIds = Arrays.asList("device1", "device2");
        BatchDeleteRequest request = new BatchDeleteRequest(deviceIds);

        BatchDeleteResponse response = new BatchDeleteResponse();
        response.setSuccess(false);
        response.setDeleted(new ArrayList<>());
        List<BatchDeleteResponse.BatchDeleteError> failed = new ArrayList<>();
        failed.add(new BatchDeleteResponse.BatchDeleteError("device1", "Device not found"));
        failed.add(new BatchDeleteResponse.BatchDeleteError("device2", "Device not found"));
        response.setFailed(failed);
        response.setTotalRequested(2);
        response.setTotalDeleted(0);

        when(deviceService.batchDeleteDevices(deviceIds)).thenReturn(response);

        // Act & Assert
        mockMvc.perform(post("/api/devices/batch-delete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.total_requested").value(2))
                .andExpect(jsonPath("$.total_deleted").value(0))
                .andExpect(jsonPath("$.deleted.length()").value(0))
                .andExpect(jsonPath("$.failed.length()").value(2));
    }
}
